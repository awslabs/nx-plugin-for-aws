{
  "$schema": "https://swc.rs/schema.json",
  "sourceMaps": true,
  "jsc": {
    "target": "es2022",
    "parser": { "syntax": "typescript", "decorators": true },
    "transform": { "legacyDecorator": true, "decoratorMetadata": true },
    "keepClassNames": true,
    "externalHelpers": false
  },
  "module": { "type": "commonjs", "strict": true },
  "exclude": [
    ".*\\.spec\\.ts$",
    ".*\\.test\\.ts$",
    ".*\\.spec\\.tsx$",
    ".*\\.test\\.tsx$",
    "[/\\\\]files[/\\\\]",
    ".*\\.template$"
  ]
}
