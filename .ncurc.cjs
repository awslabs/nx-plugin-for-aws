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
  // TODO: Address root cause of react 19.2 incompatibility with tRPC client
  // https://github.com/awslabs/nx-plugin-for-aws/issues/399
  reject: ['@hey-api/openapi-ts', 'react', 'react-dom'],
  packageFile: '{package.json,packages/**/package.json}',
  cooldown: 5, // Only latest versions published for 5 days are updated to
  dep: ['prod', 'dev', 'optional', 'packageManager', 'peer'],
};
