// Shared registry/default-repo helpers for local dev and CI.

function normalizeRepo(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\/+$/, '');
}

function getDefaultRepo() {
  // Prefer Skaffold's conventional env var, but allow a generic override.
  return (
    normalizeRepo(process.env.SKAFFOLD_DEFAULT_REPO) ||
    normalizeRepo(process.env.DEFAULT_REPO) ||
    // Default local developer experience.
    'localhost:5001'
  );
}

function getLocalRegistryConfig() {
  return {
    name: process.env.KIND_LOCAL_REGISTRY_NAME || 'kind-registry',
    hostPort: process.env.KIND_LOCAL_REGISTRY_PORT || '5001',
    internalPort: process.env.KIND_LOCAL_REGISTRY_INTERNAL_PORT || '5000',
    image: process.env.KIND_LOCAL_REGISTRY_IMAGE || 'docker.io/library/registry:2',
    volume: process.env.KIND_LOCAL_REGISTRY_VOLUME || 'kind-registry-data',
    kindNetwork: process.env.KIND_NETWORK_NAME || 'kind',
  };
}

function hasArg(args, name) {
  return args.includes(name) || args.some((a) => a.startsWith(`${name}=`));
}

function withDefaultRepoArg(args, command) {
  // Only inject for commands that build/deploy images.
  const commandsThatNeedRepo = new Set(['dev', 'debug', 'run', 'build']);
  if (!commandsThatNeedRepo.has(command)) {
    return args;
  }
  if (hasArg(args, '--default-repo')) {
    return args;
  }

  const repo = getDefaultRepo();
  if (!repo) {
    return args;
  }
  return [...args, '--default-repo', repo];
}

module.exports = {
  getDefaultRepo,
  getLocalRegistryConfig,
  withDefaultRepoArg,
};
