import Docker from 'dockerode';

const [containerName, image, hostPort] = process.argv.slice(2);

const docker = new Docker();

// Multiple dynamo table packages run serve-local in parallel sharing the same
// container. All processes attach for log streaming, but only the one that
// created the container stops it on exit — others just detach.
let container!: Docker.Container;
let created = false;

while (!container) {
  try {
    const c = docker.getContainer(containerName);
    const info = await c.inspect();
    if (!info.State.Running) {
      try {
        await c.start();
      } catch (e) {
        // 304: another parallel process started it between our inspect and start
        if ((e as { statusCode?: number }).statusCode !== 304) throw e;
      }
    }
    container = c;
  } catch (e) {
    if ((e as { statusCode?: number }).statusCode !== 404) throw e;
    try {
      container = await docker.createContainer({
        name: containerName,
        Image: image,
        User: 'root',
        Cmd: [
          '-jar',
          'DynamoDBLocal.jar',
          '-sharedDb',
          '-dbPath',
          './data',
          '-optimizeDbBeforeStartup',
          '-delayTransientStatuses',
        ],
        WorkingDir: '/home/dynamodblocal',
        ExposedPorts: { '8000/tcp': {} },
        HostConfig: {
          AutoRemove: true,
          PortBindings: { '8000/tcp': [{ HostPort: hostPort }] },
          Binds: [`${containerName}-data:/home/dynamodblocal/data`],
        },
      });
      await container.start();
      created = true;
    } catch (e2) {
      // 409: another parallel process created it between our inspect and createContainer — retry
      if ((e2 as { statusCode?: number }).statusCode !== 409) throw e2;
    }
  }
}

const stream = await container.attach({
  stream: true,
  stdout: true,
  stderr: true,
});
container.modem.demuxStream(stream, process.stdout, process.stderr);

let exiting = false;

async function cleanup() {
  if (exiting) return;
  exiting = true;
  if (created) {
    try {
      await container.stop();
    } catch (e) {
      if ((e as { statusCode?: number }).statusCode !== 404) console.error(e);
    }
  }
  process.exit(0);
}

process.on('SIGTERM', () => void cleanup());
process.on('SIGINT', () => void cleanup());
process.on('SIGHUP', () => void cleanup());

const { StatusCode } = await container.wait();
if (!exiting) process.exit(StatusCode);
