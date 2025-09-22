FROM public.ecr.aws/docker/library/node:24 AS builder

# Output directory
RUN mkdir /out

# Install Smithy CLI
# https://smithy.io/2.0/guides/smithy-cli/cli_installation.html
WORKDIR /smithy
ARG TARGETPLATFORM
RUN if [ "$TARGETPLATFORM" = "linux/arm64" ]; then ARCH="aarch64"; else ARCH="x86_64"; fi && \
    mkdir -p smithy-install/smithy && \
    curl -L https://github.com/smithy-lang/smithy/releases/download/1.61.0/smithy-cli-linux-$ARCH.zip -o smithy-install/smithy-cli-linux-$ARCH.zip && \
    unzip -qo smithy-install/smithy-cli-linux-$ARCH.zip -d smithy-install && \
    mv smithy-install/smithy-cli-linux-$ARCH/* smithy-install/smithy
RUN smithy-install/smithy/install

# Add node dependencies for bundling
WORKDIR /project
RUN npm i -g pnpm@10.15.1 rolldown@1.0.0-beta.38

# Copy project files
COPY smithy-build.json .
COPY src src

# Smithy build with Maven cache mount
RUN --mount=type=cache,target=/root/.m2/repository,id=maven-cache \
    smithy build

# Copy OpenAPI specification to output location
RUN mkdir -p /out/openapi
RUN cp /project/build/smithy/source/openapi/*.openapi.json /out/openapi/openapi.json

WORKDIR /project/build/smithy/source/typescript-ssdk-codegen

# Install SSDK dependencies with pnpm cache mount
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,id=pnpm-store \
    --mount=type=cache,target=/project/build/smithy/source/typescript-ssdk-codegen/node_modules,id=ssdk-node-modules \
    pnpm install --prefer-offline

# Install rolldown plugins with pnpm cache mount
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,id=pnpm-store \
    --mount=type=cache,target=/project/build/smithy/source/typescript-ssdk-codegen/node_modules,id=ssdk-node-modules \
    pnpm add -D rolldown-plugin-dts@0.16.5 @rollup/plugin-esm-shim@0.1.8

RUN cat <<EOF > rolldown.config.js
import { dts } from 'rolldown-plugin-dts';
import esmShim from '@rollup/plugin-esm-shim';
import fs from 'fs';
import path from 'path';

// Bundle the re2-wasm wasm file as part of the module
const re2WasmPlugin = () => ({
  name: 're2-wasm-plugin',
  resolveId: (id) => {
    if (!(id === 're2-wasm' || id.endsWith('/re2-wasm'))) return null;
    try {
      const dir = path.join(path.dirname(require.resolve('re2-wasm/package.json')), 'build/wasm');
      return fs.existsSync(path.join(dir, 're2.wasm')) && fs.existsSync(path.join(dir, 're2.js')) ? path.join(dir, 're2.js') : null;
    } catch { return null; }
  },
  load: (id) => {
    if (!(id.endsWith('re2.js') && id.includes('re2-wasm'))) return null;
    try {
      const wasmPath = path.join(path.dirname(id), 're2.wasm');
      return fs.existsSync(wasmPath) && fs.existsSync(id) ? \`var Module = { wasmBinary: Buffer.from("\${fs.readFileSync(wasmPath).toString('base64')}", "base64") }\n\${fs.readFileSync(id, 'utf8')}\` : null;
    } catch { return null; }
  }
});

export default {
  input: './src/index.ts',
  plugins: [
    re2WasmPlugin(),
    dts({ resolve: true }),
    esmShim(),
  ],
  output: [{
    dir: 'dist',
    format: 'es',
  }],
  resolve: {
    tsconfigFilename: 'tsconfig.es.json',
  },
  platform: 'node',
};
EOF

# Create SSDK bundle with rolldown
RUN --mount=type=cache,target=/project/build/smithy/source/typescript-ssdk-codegen/node_modules,id=ssdk-node-modules \
    rolldown -c

RUN mkdir -p /out/ssdk
RUN cp dist/* /out/ssdk/

# Export the /out directory
FROM scratch AS export
COPY --from=builder /out /
