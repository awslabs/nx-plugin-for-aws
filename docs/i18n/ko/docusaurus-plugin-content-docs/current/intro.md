---
sidebar_position: 1
---

# PACE Nx Plugin

PACE Nx Plugin에는 AWS 프로젝트를 신속하게 구축할 수 있는 여러 유용한 [Nx Generators](https://nx.dev/features/generate-code)가 포함되어 있습니다.

PACE Nx Plugin 사용의 장점:

- 프로젝트 빠른 구축 및 컴포넌트 추가
- 더 나은 개발 주기를 위한 `nx monorepo` 통합
- projen 컴포넌트 없음 (고객들이 이 추상화 계층을 복잡하다고 느꼈습니다)
- 프로젝트의 완전한 커스터마이징

**왜 PACE Nx Plugin을 출시하나요?**

PDK 피드백 대응: [APJ PACE Developer Experience](https://quip-amazon.com/bXVHAYgO6IxM/APJ-PACE-Developer-Experience)

## 시작하기

### 전제 조건

#### Nx Console IDE 플러그인

선택사항이지만, VSCode용 Nx Console(또는 사용 가능한 경우 동등한 IDE용 플러그인) 설치를 권장합니다.

- [VSCode용 NX Console 설치](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)
- [JetBrains/IntelliJ용 NX Console 설치](https://plugins.jetbrains.com/plugin/21060-nx-console)

#### PNPM

패키지 매니저는 자유롭게 선택할 수 있지만, `pnpm` 사용을 권장합니다. 다음으로 설치:

```
npm i -g pnpm
```

:::info
PNPM 버전은 8.7 이상이어야 합니다! 버전 9를 권장합니다.
:::

### Nx 통합 monorepo 생성

Nx monorepo를 생성하려면 CLI 에디터에서 다음을 입력하세요:

```
pnpm dlx create-nx-workspace <my-prototype> --ci=skip --preset=ts

cd <my-prototype>
```

monorepo에 필요한 모든 관련 파일과 종속성이 지정된 폴더에 생성됩니다.

Nx 사용 방법에 대한 자세한 내용:

- monorepo 설정에서 React를 Nx와 함께 사용하는 방법은 [React 모노레포 튜토리얼](https://nx.dev/getting-started/tutorials/react-monorepo-tutorial)을 참조하세요.
- [통합 리포지토리 시작하기](https://www.youtube.com/watch?v=weZ7NAzB7PM) 비디오 튜토리얼을 시청하세요.

### PACE Nx plugin 추가

PACE Nx plugin을 설치하려면 CLI 에디터에서 다음을 입력하세요:

```
pnpm nx add @aws/nx-plugin
```

이렇게 하면 플러그인에서 정의한 Nx 제너레이터를 monorepo에서 사용할 수 있게 됩니다.

### 프로젝트에 컴포넌트 추가

프로젝트에 컴포넌트를 추가하려면 IDE(Nx Console)의 UI 또는 CLI를 사용할 수 있습니다.

#### VSCode NX Console 사용

1. 왼쪽의 **Nx** 콘솔 플러그인을 선택하고 **Generate (UI)**를 클릭합니다. 컴포넌트 제너레이터 선택 목록이 표시됩니다.
   ![VSCode Generate UI](/img/nx-generate-ui.png)
2. 추가하려는 컴포넌트의 제너레이터를 선택합니다. 예를 들어, `infra#app`등.
   ![Component generator](/img/nx-component-generator.png)
3. 세부 정보를 입력합니다. 하단의 터미널 창에서 드라이 런이 실행되어 생성될 파일이 표시됩니다.
4. 계속하려면 **Generate**를 클릭합니다.
   ![Generate action](/img/nx-infra-app-generate.png)

5. 터미널에서 모든 것을 빌드하기 위해 다음을 실행합니다:

   ```
   pnpm nx run-many --target build --all
   ```

#### CLI 사용:

1. 터미널에서 제너레이터를 실행하기 위해 다음을 입력합니다:

   ```
   pnpm exec nx generate <generator>
   ```

   인프라 예시:

   ```
   pnpm exec nx generate @aws/nx-plugin:infra#app
   ```

2. 프롬프트에 따라 컴포넌트를 생성하고 프로젝트에 추가합니다.

3. 터미널에서 모든 것을 설치하고 빌드하기 위해 다음을 실행합니다:

   ```
   pnpm nx run-many --target build --all
   ```

## 가이드

### tRPC API

타입 안전 API를 위한 tRPC API 사용 방법에 대한 자세한 내용은 [tRPC 문서](https://trpc.io/)를 참조하세요. PDK의 타입 안전 API 제너레이터는 곧 출시될 예정입니다!

### CDK 인프라스트럭처

CDK 인프라스트럭처를 합성하려면 패키지를 빌드하기만 하면 됩니다:

```
pnpm exec nx run <my-infra-project>:build
```

배포하려면 `deploy` 타겟을 사용할 수 있습니다:

```
pnpm exec nx run <my-infra-project>:deploy
```

## 문제 해결

- 프로젝트가 표시되지 않는 경우 주기적으로 `nx workspace`를 새로 고쳐야 할 수 있습니다.
  - VSCode: NX 워크스페이스를 새로 고치려면 `cmd + shift + p → NX`
- IDE에서 패키지가 없다는 빨간색 표시가 나타나면 TypeScript 서버를 다시 시작하세요.
  - VSCode: TS 서버를 다시 시작하려면 `cmd + shift + p → TypeScript`
- 사이트 생성에 실패한 경우:
  - 생성에 사용된 스크립트를 복사/붙여넣기하고 `--verbose` 플래그를 추가하여 자세한 내용을 확인하세요.
  - 이전 제너레이터를 실행한 후 `pnpm i`를 실행해 보세요.
