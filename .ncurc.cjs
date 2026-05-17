module.exports = {
  upgrade: true,
  target: (name, semver) => {
    // Check if semver array exists and has elements
    if (semver && semver.length > 0 && semver[0]) {
      const currentVersion = semver[0];
      // Check if current version has pre-release tag
      if (currentVersion.release) {
        return 'latest'; // Upgrade pre-release to latest pre-release
      }
    }
    return 'minor'; // Upgrade stable to latest minor
  },
  reject: [
    '@hey-api/openapi-ts',
    '@modelcontextprotocol/inspector', // TODO: consider allowing updates when transitive dep on @types/react 18.x is removed
    // Pinned due to incompatibility between @tailwindcss/vite and rolldown-vite (missing `tsconfigPaths` field on BindingViteResolvePluginConfig)
    'vite',
    'tailwindcss',
    '@tailwindcss/vite',
    'rolldown',
    // Pinned due to @swc/core 1.15.33 dropping @swc/helpers from optionalDependencies, which breaks @swc-node/register transpilation in nx
    '@swc/core',
    // Pinned due to @copilotkit/react-core 1.57 removing `threadId` from `UseAgentProps` (breaking change)
    '@copilotkit/react-core',
  ],
  packageFile: '{package.json,packages/**/package.json}',
  cooldown: 1, // Only latest versions published for at least 1 day are updated to
  dep: ['prod', 'dev', 'optional', 'packageManager', 'peer'],
};
