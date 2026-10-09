'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rewriteNodeResolvConf, dropIpv6Nameservers } = require('./node-resolv-conf');

test('drops the IPv6 nameserver when an IPv4 nameserver exists', () => {
  const input = 'nameserver 10.89.0.1\nnameserver fc00:f853:ccd:e793::1\noptions ndots:0\n';
  assert.equal(dropIpv6Nameservers(input), 'nameserver 10.89.0.1\noptions ndots:0\n');
});

test('keeps IPv6 nameservers when no IPv4 nameserver exists', () => {
  const input = 'nameserver fc00::1\nnameserver fc00::2\n';
  assert.equal(dropIpv6Nameservers(input), input);
});

test('keeps all IPv4 nameservers', () => {
  const input = 'nameserver 10.89.0.1\nnameserver 192.168.1.1\n';
  assert.equal(dropIpv6Nameservers(input), input);
});

test('leaves a file with no nameserver unchanged', () => {
  assert.equal(dropIpv6Nameservers('options ndots:0\n'), 'options ndots:0\n');
});

test('removes search lines and IPv6 nameservers together', () => {
  const input = 'search str.wwstar.com\nnameserver 10.89.0.1\nnameserver fc00::1\n';
  assert.equal(rewriteNodeResolvConf(input), 'nameserver 10.89.0.1\n');
});

test('is idempotent', () => {
  const once = rewriteNodeResolvConf('nameserver 10.89.0.1\nnameserver fc00::1\n');
  assert.equal(rewriteNodeResolvConf(once), once);
});
