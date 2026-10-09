'use strict';

function stripSearchDomains(resolvConf) {
  return resolvConf
    .split('\n')
    .filter((line) => !line.trim().startsWith('search '))
    .join('\n');
}

function nameserverAddress(line) {
  const match = /^\s*nameserver\s+(\S+)/.exec(line);
  return match ? match[1] : null;
}

// Podman netavark IPv6 DNS refuses every query. CoreDNS spreads uncached lookups across all
// nameservers, so a share of them fail. Drop IPv6 nameservers only when an IPv4 one remains.
function dropIpv6Nameservers(resolvConf) {
  const lines = resolvConf.split('\n');
  const addresses = lines.map(nameserverAddress).filter(Boolean);
  if (!addresses.some((address) => !address.includes(':'))) {
    return resolvConf;
  }
  return lines
    .filter((line) => {
      const address = nameserverAddress(line);
      return address === null || !address.includes(':');
    })
    .join('\n');
}

function rewriteNodeResolvConf(resolvConf) {
  return dropIpv6Nameservers(stripSearchDomains(resolvConf));
}

module.exports = { stripSearchDomains, dropIpv6Nameservers, rewriteNodeResolvConf };
