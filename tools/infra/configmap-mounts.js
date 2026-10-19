'use strict';

/**
 * Find workloads that reference a ConfigMap absent from their own namespace (#971).
 * A ConfigMap is namespaced. A pod that mounts one from another namespace never starts.
 * Only the first container's `envFrom` and the pod `volumes` are checked, which is where the
 * `workspace-ca` component writes them.
 */

const POD_SPEC_PATHS = {
  Deployment: (doc) => doc.spec?.template?.spec,
  StatefulSet: (doc) => doc.spec?.template?.spec,
  DaemonSet: (doc) => doc.spec?.template?.spec,
  Job: (doc) => doc.spec?.template?.spec,
  CronJob: (doc) => doc.spec?.jobTemplate?.spec?.template?.spec,
};

function namespaceOf(doc) {
  return doc.metadata?.namespace || 'default';
}

function referencedConfigMaps(podSpec) {
  const names = new Set();
  for (const volume of podSpec.volumes ?? []) {
    // A volume with `optional: true` does not block the pod.
    if (volume.configMap?.name && volume.configMap.optional !== true) {
      names.add(volume.configMap.name);
    }
  }
  for (const container of [...(podSpec.initContainers ?? []), ...(podSpec.containers ?? [])]) {
    for (const source of container.envFrom ?? []) {
      if (source.configMapRef?.name && source.configMapRef.optional !== true) {
        names.add(source.configMapRef.name);
      }
    }
  }
  return names;
}

function findMissingConfigMapProblems(documents) {
  const present = new Set(
    documents
      .filter((doc) => doc.kind === 'ConfigMap')
      .map((doc) => `${namespaceOf(doc)}/${doc.metadata.name}`),
  );
  const items = [];
  for (const doc of documents) {
    const podSpec = POD_SPEC_PATHS[doc.kind]?.(doc);
    if (!podSpec) continue;
    const namespace = namespaceOf(doc);
    for (const name of referencedConfigMaps(podSpec)) {
      if (!present.has(`${namespace}/${name}`)) {
        items.push(
          `${doc.kind}/${doc.metadata.name} (namespace ${namespace}) needs ConfigMap ${name}`,
        );
      }
    }
  }
  if (items.length === 0) return [];
  return [
    {
      headline: 'workloads reference a ConfigMap that is missing from their namespace',
      detail: [
        'A pod can only use a ConfigMap from its own namespace.',
        'Add the ConfigMap to that namespace, or stop the workload from referencing it.',
      ],
      items,
    },
  ];
}

module.exports = { findMissingConfigMapProblems };
