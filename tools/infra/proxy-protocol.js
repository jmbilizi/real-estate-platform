'use strict';

/**
 * PROXY protocol pairing (#853).
 *
 * The Hetzner load balancer annotation `load-balancer.hetzner.cloud/uses-proxyprotocol` and the
 * ingress-nginx key `use-proxy-protocol` must agree. If only one side is on, every request
 * fails: nginx rejects a connection with no PROXY header, and a PROXY header that nginx does not
 * expect is read as a broken request. The check reads a rendered environment.
 *
 * A provider with no Hetzner load balancer (local podman/kind) must have both off.
 */

const LB_ANNOTATION = 'load-balancer.hetzner.cloud/uses-proxyprotocol';
const NGINX_KEY = 'use-proxy-protocol';
const SERVICE_NAME = 'ingress-nginx-controller';

function isOn(value) {
  return String(value).toLowerCase() === 'true';
}

function findProxyProtocolProblems(documents, { provider } = {}) {
  const service = documents.find((d) => d.kind === 'Service' && d.metadata?.name === SERVICE_NAME);
  const configMap = documents.find(
    (d) => d.kind === 'ConfigMap' && d.metadata?.name === SERVICE_NAME,
  );
  const lbOn = isOn(service?.metadata?.annotations?.[LB_ANNOTATION]);
  const nginxOn = isOn(configMap?.data?.[NGINX_KEY]);

  if (provider !== 'hetzner') {
    if (!lbOn && !nginxOn) return [];
    return [
      {
        headline: 'PROXY protocol is on where no Hetzner load balancer exists',
        detail: [`Remove ${LB_ANNOTATION} and ${NGINX_KEY} from the ${provider} overlay.`],
        items: [`${LB_ANNOTATION}=${lbOn}`, `${NGINX_KEY}=${nginxOn}`],
      },
    ];
  }

  if (lbOn === nginxOn) return [];
  return [
    {
      headline: 'Hetzner load balancer and ingress-nginx disagree on PROXY protocol',
      detail: [
        'Change both in the same commit. If only one side is on, all ingress traffic fails.',
        `Set ${LB_ANNOTATION} on the Service and ${NGINX_KEY} in the ConfigMap, or remove both.`,
      ],
      items: [`${LB_ANNOTATION}=${lbOn}`, `${NGINX_KEY}=${nginxOn}`],
    },
  ];
}

module.exports = { findProxyProtocolProblems, LB_ANNOTATION, NGINX_KEY };
