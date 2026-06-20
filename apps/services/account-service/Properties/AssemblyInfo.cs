// <copyright file="AssemblyInfo.cs" company="PlaceholderCompany">
// Copyright (c) PlaceholderCompany. All rights reserved.
// </copyright>

using System.Runtime.CompilerServices;

// Required so Castle DynamicProxy (used by Moq) can create proxies for
// IUserStore<ApplicationUser> when Microsoft.Extensions.Identity.Core is strong-named.
[assembly: InternalsVisibleTo("DynamicProxyGenAssembly2")]

// Required so the test project can access internal types (e.g. via WebApplicationFactory).
[assembly: InternalsVisibleTo("account-service.Tests")]
