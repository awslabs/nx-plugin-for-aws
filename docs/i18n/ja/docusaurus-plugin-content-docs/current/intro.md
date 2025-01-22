---
sidebar_position: 1
---

# PACE Nx Plugin

PACE Nx Plugin には、AWS プロジェクトを迅速に構築するための便利な[Nx Generators](https://nx.dev/features/generate-code)が含まれています。

PACE Nx Plugin を使用する利点：

- プロジェクトの迅速な構築とコンポーネントの追加
- より良い開発サイクルのための`nx monorepo`の統合
- projen コンポーネントなし（顧客はこの抽象化レイヤーを複雑だと感じていました）
- プロジェクトの完全なカスタマイズ

**なぜ PACE Nx Plugin をリリースするのか？**

PDK フィードバックの対応：[APJ PACE Developer Experience](https://quip-amazon.com/bXVHAYgO6IxM/APJ-PACE-Developer-Experience)

## はじめに

### 前提条件

#### Nx Console IDE プラグイン

オプションですが、VSCode 用の Nx Console（または利用可能な場合は同等の IDE 用プラグイン）のインストールをお勧めします。

- [VSCode 用の NX Console をインストール](https://marketplace.visualstudio.com/items?itemName=nrwl.angular-console)
- [JetBrains/IntelliJ 用の NX Console をインストール](https://plugins.jetbrains.com/plugin/21060-nx-console)

#### PNPM

パッケージマネージャーは自由に選択できますが、`pnpm`の使用をお勧めします。以下でインストール：

```
npm i -g pnpm
```

:::info
PNPM のバージョンは 8.7 以上である必要があります！バージョン 9 を推奨します。
:::

### Nx 統合 monorepo の作成

Nx monorepo を作成するには、CLI エディターで以下を入力します：

```
pnpm dlx create-nx-workspace <my-prototype> --ci=skip --preset=ts

cd <my-prototype>
```

monorepo に必要なすべての関連ファイルと依存関係が指定されたフォルダに作成されます。

Nx の使用方法の詳細については：

- monorepo セットアップで React を Nx と使用する方法については、[React モノレポチュートリアル](https://nx.dev/getting-started/tutorials/react-monorepo-tutorial)を参照してください。
- [統合リポジトリの使用開始](https://www.youtube.com/watch?v=weZ7NAzB7PM)のビデオチュートリアルをご覧ください。

### PACE Nx plugin の追加

PACE Nx plugin をインストールするには、CLI エディターで以下を入力します：

```
pnpm nx add @aws/nx-plugin
```

これにより、プラグインで定義された Nx ジェネレーターが monorepo で使用可能になります。

### プロジェクトへのコンポーネントの追加

プロジェクトにコンポーネントを追加するには、IDE（Nx Console）の UI または CLI を使用できます。

#### VSCode NX Console の使用

1. 左側の**Nx**コンソールプラグインを選択し、**Generate (UI)**をクリックします。コンポーネントジェネレーター選択リストが表示されます。

   ![VSCode Generate UI](/img/nx-generate-ui.png)

2. 追加したいコンポーネントのジェネレーターを選択します。例えば、`infra#app`など。
   ![Component generator](/img/nx-component-generator.png)
3. 詳細を入力します。下部のターミナルウィンドウでドライランが実行され、作成されるファイルが表示されます。
4. 続行するには、**Generate**をクリックします。
   ![Generate action](/img/nx-infra-app-generate.png)

5. ターミナルで、すべてをビルドするために以下を実行します：

   ```
   pnpm nx run-many --target build --all
   ```

#### CLI の使用：

1. ターミナルで、ジェネレーターを実行するために以下を入力します：

   ```
   pnpm exec nx generate <generator>
   ```

   インフラの例：

   ```
   pnpm exec nx generate @aws/nx-plugin:infra#app
   ```

2. プロンプトに従ってコンポーネントを生成し、プロジェクトに追加します。

3. ターミナルで、すべてをインストールしビルドするために以下を実行します：

   ```
   pnpm nx run-many --target build --all
   ```

## ガイド

### tRPC API

型安全な API のための tRPC API の使用方法の詳細については、[tRPC ドキュメント](https://trpc.io/)を参照してください。PDK の型安全 API のジェネレーターは近日公開予定です！

### CDK インフラストラクチャ

CDK インフラストラクチャを合成するには、パッケージをビルドするだけです：

```
pnpm exec nx run <my-infra-project>:build
```

デプロイするには、`deploy`ターゲットを使用できます：

```
pnpm exec nx run <my-infra-project>:deploy
```

## トラブルシューティング

- プロジェクトが表示されない場合は、定期的に`nx workspace`を更新する必要があるかもしれません。
  - VSCode：NX ワークスペースを更新するには、`cmd + shift + p → NX`
- IDE でパッケージが見つからないという赤い表示が出る場合は、TypeScript サーバーを再起動してください。
  - VSCode：TS サーバーを再起動するには、`cmd + shift + p → TypeScript`
- サイトの生成に失敗した場合：
  - 生成に使用したスクリプトをコピー/ペーストし、`--verbose`フラグを追加して詳細を確認してください。
  - 前のジェネレーターを実行した後に`pnpm i`を実行してみてください。
