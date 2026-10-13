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
const HOSTNAME_ANNOTATION = 'load-balancer.hetzner.cloud/hostname';
const PRIVATE_IP_ANNOTATION = 'load-balancer.hetzner.cloud/use-private-ip';
const CIDR_KEY = 'proxy-real-ip-cidr';
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

  const missing = [!service && 'Service', !configMap && 'ConfigMap'].filter(Boolean);
  if (missing.length > 0) {
    return [
      {
        headline: `ingress-nginx-controller ${missing.join(' and ')} missing from the render`,
        detail: ['The PROXY protocol pairing cannot be checked without both resources.'],
        items: missing,
      },
    ];
  }

  if (lbOn && nginxOn) {
    const annotations = service.metadata.annotations ?? {};
    const problems = [];
    if (!annotations[HOSTNAME_ANNOTATION]) {
      problems.push({
        headline: 'PROXY protocol is on without a load balancer hostname',
        detail: [
          `Set ${HOSTNAME_ANNOTATION}. Without it, in-cluster traffic to the LB IP skips the PROXY header.`,
          'The cert-manager HTTP-01 self-check is such traffic, so certificates stop issuing.',
        ],
        items: [HOSTNAME_ANNOTATION],
      });
    }
    // A forged PROXY header lets a client pick its own IP. Trust it only from the load balancer.
    const cidrs = String(configMap.data?.[CIDR_KEY] ?? '')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cidrs.length === 0 || cidrs.some((c) => c === '0.0.0.0/0' || c === '::/0')) {
      problems.push({
        headline: 'PROXY protocol is on and any peer is trusted to set the client IP',
        detail: [
          `Set ${CIDR_KEY} to the private subnet of the load balancer. Missing or 0.0.0.0/0 lets a client forge its IP.`,
        ],
        items: [`${CIDR_KEY}=${configMap.data?.[CIDR_KEY] ?? '(unset)'}`],
      });
    }
    if (
      !isOn(annotations[PRIVATE_IP_ANNOTATION]) ||
      service.spec?.externalTrafficPolicy !== 'Local'
    ) {
      problems.push({
        headline: 'The trusted CIDR only holds with a private LB and source IP kept',
        detail: [
          `Set ${PRIVATE_IP_ANNOTATION}: "true" so the peer is a private address.`,
          'Set spec.externalTrafficPolicy: Local so kube-proxy does not rewrite a public peer to a node address.',
        ],
        items: [
          `${PRIVATE_IP_ANNOTATION}=${annotations[PRIVATE_IP_ANNOTATION]}`,
          `externalTrafficPolicy=${service.spec?.externalTrafficPolicy}`,
        ],
      });
    }
    if (problems.length > 0) return problems;
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

module.exports = {
  findProxyProtocolProblems,
  LB_ANNOTATION,
  HOSTNAME_ANNOTATION,
  PRIVATE_IP_ANNOTATION,
  CIDR_KEY,
  NGINX_KEY,
};
