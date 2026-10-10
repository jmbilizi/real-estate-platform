// <copyright file="LookingForValidator.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Text.RegularExpressions;
using AccountService.Dtos;
using AccountService.Models;

namespace AccountService.Helpers;

/// <summary>Validates a <see cref="LookingForRequest"/>. Every refusal names the field.</summary>
internal static partial class LookingForValidator
{
    /// <summary>Checks the request.</summary>
    /// <param name="request">The request.</param>
    /// <param name="today">The current UTC date.</param>
    /// <returns>Field name to messages. Empty when the request is valid.</returns>
    internal static Dictionary<string, string[]> Validate(LookingForRequest? request, DateOnly today)
    {
        var errors = new Dictionary<string, string[]>();
        if (request is null)
        {
            errors["body"] = new[] { "A request body is required." };
            return errors;
        }

        if (request.Intent is null || !LookingForLimits.Intents.Contains(request.Intent))
        {
            errors["intent"] = new[] { "Intent must be buy or rent." };
        }

        ValidatePlaces(request.Places, errors);
        ValidateRange("priceMin", "priceMax", request.PriceMin, request.PriceMax, LookingForLimits.MaxPrice, errors);
        ValidateRange("bedsMin", null, request.BedsMin, null, LookingForLimits.MaxRooms, errors);
        ValidateRange("bathsMin", null, request.BathsMin, null, LookingForLimits.MaxRooms, errors);

        if (request.HomeTypes is not null)
        {
            var invalid = request.HomeTypes.Any(t => t is null || !LookingForLimits.HomeTypes.Contains(t));
            var duplicate = request.HomeTypes.Distinct(StringComparer.Ordinal).Count() != request.HomeTypes.Count;
            if (invalid || duplicate)
            {
                errors["homeTypes"] = new[] { "Home types must be distinct search home-type values." };
            }
        }

        ValidateWhen(request, today, errors);
        return errors;
    }

    [GeneratedRegex(@"^[A-Z]{2}$")]
    private static partial Regex StateRegex();

    [GeneratedRegex(@"^\d{5}$")]
    private static partial Regex ZipRegex();

    [GeneratedRegex(@"^[\p{L}\p{N}][\p{L}\p{N} .'&-]{0,99}$")]
    private static partial Regex NameRegex();

    private static void ValidatePlaces(List<LookingForPlace>? places, Dictionary<string, string[]> errors)
    {
        if (places is null || places.Count < 1 || places.Count > LookingForLimits.MaxPlaces)
        {
            errors["places"] = new[] { $"Give 1 to {LookingForLimits.MaxPlaces} places." };
            return;
        }

        for (var i = 0; i < places.Count; i++)
        {
            var place = places[i];
            if (place is null || !PlaceIsValid(place))
            {
                errors[$"places[{i}]"] = new[] { "Place needs a valid kind and the fields of that kind." };
            }
        }
    }

    private static bool PlaceIsValid(LookingForPlace place)
    {
        if (place.Kind is null || !LookingForLimits.PlaceKinds.Contains(place.Kind))
        {
            return false;
        }

        var stateOk = place.State is not null && StateRegex().IsMatch(place.State);
        var city = place.City is not null && NameRegex().IsMatch(place.City);
        var zip = place.Zip is not null && ZipRegex().IsMatch(place.Zip);

        // Only city and zip until the web form can show and edit the other kinds (#768).
        return stateOk && place.Name is null && place.County is null && place.Kind switch
        {
            "city" => city && place.Zip is null,
            "zip" => zip && city,
            _ => false,
        };
    }

    private static void ValidateRange(
        string minField,
        string? maxField,
        int? min,
        int? max,
        int ceiling,
        Dictionary<string, string[]> errors)
    {
        if (min is < 0 || min > ceiling)
        {
            errors[minField] = new[] { $"Must be between 0 and {ceiling}." };
        }

        if (max is null || maxField is null)
        {
            return;
        }

        if (max < 0 || max > ceiling)
        {
            errors[maxField] = new[] { $"Must be between 0 and {ceiling}." };
        }
        else if (min is not null && min > max)
        {
            errors[maxField] = new[] { "Maximum must not be below the minimum." };
        }
    }

    private static void ValidateWhen(LookingForRequest request, DateOnly today, Dictionary<string, string[]> errors)
    {
        if (request.WhenStart is null)
        {
            if (request.WhenEnd is not null)
            {
                errors["whenEnd"] = new[] { "An end date needs a start date." };
            }

            return;
        }

        // A client in a zone behind UTC can pick a local "today" that is yesterday in UTC.
        if (request.WhenStart < today.AddDays(-1))
        {
            errors["whenStart"] = new[] { "The date must not be in the past." };
        }
        else if (request.WhenEnd is not null && request.WhenEnd < request.WhenStart)
        {
            errors["whenEnd"] = new[] { "The end date must not be before the start date." };
        }
    }
}
