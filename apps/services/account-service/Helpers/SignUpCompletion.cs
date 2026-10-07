// <copyright file="SignUpCompletion.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using AccountService.Data;
using AccountService.Models;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace AccountService.Helpers;

/// <summary>
/// The last sign-up step: the one place an <see cref="ApplicationUser"/> row is created for a new
/// address (#654).
/// </summary>
/// <remarks>
/// <para>
/// The proof is used up first, so a caller without a proof learns nothing about the password
/// policy and the breach check cannot run as an oracle. The proof comes back when no account
/// results from the call: a rejected password, or an error.
/// </para>
/// <para>
/// The password is checked and hashed before the transaction opens, so no connection waits on the
/// breach check. The new account and its role commit together. The unique index on the normalized
/// user name (the address, case-insensitive) is the final guard in a race. The pending row is
/// deleted after the commit. A failure there is harmless: the proof is spent and the purge removes
/// the row.
/// </para>
/// <para>Nothing here logs the address, the password or the proof.</para>
/// </remarks>
/// <param name="db">The database.</param>
/// <param name="signUp">The sign-up service, for the proof.</param>
/// <param name="users">The user manager. It validates the password and assigns the default role.</param>
internal sealed class SignUpCompletion(
    AccountDbContext db,
    SignUpService signUp,
    UserManager<ApplicationUser> users)
{
    /// <summary>Completes a sign-up.</summary>
    /// <param name="email">The submitted address.</param>
    /// <param name="proof">The submitted proof.</param>
    /// <param name="password">The submitted password, as typed.</param>
    /// <param name="cancellationToken">A token to cancel the call.</param>
    /// <returns>The outcome. On <c>Created</c> it carries the new account.</returns>
    internal async Task<SignUpCompleteResult> CompleteAsync(
        string? email,
        string? proof,
        string? password,
        CancellationToken cancellationToken = default)
    {
        if (!SignUpEmail.TryNormalize(email, out var key, out var entered)
            || !await signUp.TryConsumeProofAsync(entered, proof, cancellationToken).ConfigureAwait(false))
        {
            return new SignUpCompleteResult(SignUpCompleteStatus.InvalidProof);
        }

        try
        {
            var result = await this.CreateAsync(key, entered, password ?? string.Empty, cancellationToken).ConfigureAwait(false);
            if (result.Status == SignUpCompleteStatus.PasswordRejected)
            {
                await signUp.ReleaseProofAsync(entered, proof, CancellationToken.None).ConfigureAwait(false);
            }

            return result;
        }
        catch
        {
            // No account came of this call. The user keeps the proof and tries again.
            await signUp.ReleaseProofAsync(entered, proof, CancellationToken.None).ConfigureAwait(false);
            throw;
        }
    }

    private static Task RollbackAsync(IDbContextTransaction? transaction) =>
        transaction is null ? Task.CompletedTask : transaction.RollbackAsync(CancellationToken.None);

    private async Task<SignUpCompleteResult> CreateAsync(string key, string entered, string password, CancellationToken cancellationToken)
    {
        // An account or a soft-deleted account holds the address. The answer is the same for both.
        if (await users.FindByEmailAsync(entered).ConfigureAwait(false) is not null)
        {
            await this.DropPendingAsync(key).ConfigureAwait(false);
            return new SignUpCompleteResult(SignUpCompleteStatus.EmailUnavailable);
        }

        var user = new ApplicationUser { UserName = entered, Email = entered, EmailConfirmed = true };

        // The validators run here, outside the transaction, so the breach check holds no connection.
        var codes = new List<string>();
        foreach (var validator in users.PasswordValidators)
        {
            var checkedPassword = await validator.ValidateAsync(users, user, password).ConfigureAwait(false);
            codes.AddRange(checkedPassword.Errors.Select(e => e.Code));
        }

        if (codes.Count > 0)
        {
            return new SignUpCompleteResult(SignUpCompleteStatus.PasswordRejected, Errors: codes.Distinct().ToArray());
        }

        user.PasswordHash = users.PasswordHasher.HashPassword(user, password);

        var transaction = db.Database.IsRelational()
            ? await db.Database.BeginTransactionAsync(cancellationToken).ConfigureAwait(false)
            : null;
        await using (transaction)
        {
            IdentityResult created;
            try
            {
                created = await users.CreateAsync(user).ConfigureAwait(false);
            }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear();
                await RollbackAsync(transaction).ConfigureAwait(false);
                if (await users.FindByEmailAsync(entered).ConfigureAwait(false) is null)
                {
                    // Not a parallel sign-up. A database fault surfaces as one.
                    throw;
                }

                // The unique index refused a parallel sign-up for the same address.
                await this.DropPendingAsync(key).ConfigureAwait(false);
                return new SignUpCompleteResult(SignUpCompleteStatus.EmailUnavailable);
            }

            if (!created.Succeeded)
            {
                db.ChangeTracker.Clear();
                await RollbackAsync(transaction).ConfigureAwait(false);
                if (created.Errors.Any(e => e.Code is nameof(IdentityErrorDescriber.DuplicateEmail) or nameof(IdentityErrorDescriber.DuplicateUserName)))
                {
                    await this.DropPendingAsync(key).ConfigureAwait(false);
                    return new SignUpCompleteResult(SignUpCompleteStatus.EmailUnavailable);
                }

                throw new InvalidOperationException(
                    "The account was not created: " + string.Join(", ", created.Errors.Select(e => e.Code)));
            }

            if (transaction is not null)
            {
                await transaction.CommitAsync(cancellationToken).ConfigureAwait(false);
            }
        }

        await this.DropPendingAsync(key).ConfigureAwait(false);
        return new SignUpCompleteResult(SignUpCompleteStatus.Created, user);
    }

    private async Task DropPendingAsync(string key)
    {
        // Clear first: a tracked row from the proof step has a stale version.
        db.ChangeTracker.Clear();
        try
        {
            var rows = await db.PendingRegistrations.Where(p => p.Email == key).ToListAsync(CancellationToken.None).ConfigureAwait(false);
            if (rows.Count > 0)
            {
                db.PendingRegistrations.RemoveRange(rows);
                await db.SaveChangesAsync(CancellationToken.None).ConfigureAwait(false);
            }
        }
        catch (DbUpdateException)
        {
            // A parallel write changed the row. The purge removes it at expiry.
            db.ChangeTracker.Clear();
        }
    }
}
