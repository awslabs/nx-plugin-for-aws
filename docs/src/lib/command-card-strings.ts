/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The chrome shared by the command cards, in each language the docs ship in.
 *
 * Kept here rather than in either card so the run-generator and create-workspace
 * cards label the same controls the same way.
 */
const STRINGS = {
  runTitle: {
    en: 'Run this generator',
    jp: 'このジェネレーターを実行',
    ko: '이 제너레이터 실행',
    fr: 'Exécuter ce générateur',
    it: 'Esegui questo generatore',
    es: 'Ejecute este generador',
    pt: 'Execute este gerador',
    zh: '运行此生成器',
    vi: 'Chạy generator này',
  },
  workspaceTitle: {
    en: 'Create your workspace',
    jp: 'ワークスペースを作成',
    ko: '워크스페이스 생성',
    fr: 'Créez votre espace de travail',
    it: 'Crea il tuo workspace',
    es: 'Cree su espacio de trabajo',
    pt: 'Crie seu workspace',
    zh: '创建工作区',
    vi: 'Tạo workspace của bạn',
  },
  build: {
    en: 'Build your command',
    jp: 'コマンドを組み立てる',
    ko: '명령 구성하기',
    fr: 'Composez votre commande',
    it: 'Componi il tuo comando',
    es: 'Construya su comando',
    pt: 'Monte seu comando',
    zh: '构建你的命令',
    vi: 'Xây dựng lệnh của bạn',
  },
  pinned: {
    en: 'Options for this step',
    jp: 'このステップのオプション',
    ko: '이 단계의 옵션',
    fr: 'Options de cette étape',
    it: 'Opzioni di questo passaggio',
    es: 'Opciones de este paso',
    pt: 'Opções desta etapa',
    zh: '此步骤的选项',
    vi: 'Tùy chọn cho bước này',
  },
  copyCommand: {
    en: 'Copy the command',
    jp: 'コマンドをコピー',
    ko: '명령 복사',
    fr: 'Copier la commande',
    it: 'Copia il comando',
    es: 'Copiar el comando',
    pt: 'Copiar o comando',
    zh: '复制命令',
    vi: 'Sao chép lệnh',
  },
  defaultValue: {
    en: 'Default',
    jp: 'デフォルト',
    ko: '기본값',
    fr: 'Par défaut',
    it: 'Predefinito',
    es: 'Predeterminado',
    pt: 'Padrão',
    zh: '默认值',
    vi: 'Mặc định',
  },
  reset: {
    en: 'Reset',
    jp: 'リセット',
    ko: '초기화',
    fr: 'Réinitialiser',
    it: 'Reimposta',
    es: 'Restablecer',
    pt: 'Redefinir',
    zh: '重置',
    vi: 'Đặt lại',
  },
  required: {
    en: 'Required',
    jp: '必須',
    ko: '필수',
    fr: 'Requis',
    it: 'Obbligatorio',
    es: 'Requerido',
    pt: 'Obrigatório',
    zh: '必需',
    vi: 'Bắt buộc',
  },
  showAll: {
    en: 'Show all',
    jp: 'すべて表示',
    ko: '전체 보기',
    fr: 'Tout afficher',
    it: 'Mostra tutti',
    es: 'Mostrar todo',
    pt: 'Mostrar tudo',
    zh: '显示全部',
    vi: 'Hiện tất cả',
  },
  showFewer: {
    en: 'Show fewer',
    jp: '折りたたむ',
    ko: '접기',
    fr: 'Réduire',
    it: 'Mostra meno',
    es: 'Mostrar menos',
    pt: 'Mostrar menos',
    zh: '收起',
    vi: 'Thu gọn',
  },
  dryRunSummary: {
    en: 'You can also perform a dry-run to see what files would be changed',
    jp: '変更されるファイルを確認するためにドライランを実行することもできます',
    ko: '어떤 파일이 변경될지 확인하기 위해 드라이 런을 수행할 수도 있습니다',
    fr: 'Vous pouvez également effectuer une simulation pour voir quels fichiers seraient modifiés',
    it: 'Puoi anche eseguire una prova per vedere quali file verrebbero modificati',
    es: 'También puede realizar una ejecución en seco para ver qué archivos se cambiarían',
    pt: 'Você também pode realizar uma execução simulada para ver quais arquivos seriam alterados',
    zh: '您还可以执行试运行以查看哪些文件会被更改',
    vi: 'Bạn cũng có thể thực hiện chạy thử để xem những tệp nào sẽ bị thay đổi',
  },
} as const;

export type CommandCardStrings = Record<keyof typeof STRINGS, string>;

export const commandCardStrings = (locale: string): CommandCardStrings =>
  Object.fromEntries(
    Object.entries(STRINGS).map(([key, translations]) => [
      key,
      (translations as Record<string, string>)[locale] ?? translations.en,
    ]),
  ) as CommandCardStrings;
