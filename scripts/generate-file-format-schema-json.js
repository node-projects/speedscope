#!/usr/bin/env node
const child_process = require('child_process')

// Convert the file-format-spec.ts file into a json schema file
let jsonSchema = child_process.execFileSync(
  process.execPath,
  [
    require.resolve('typescript-json-schema/bin/typescript-json-schema'),
    './src/lib/file-format-spec.ts',
    '--titles',
    '--required',
    '--topRef',
    '*',
    '--skipLibCheck',
  ],
  {
    encoding: 'utf8',
  },
)
jsonSchema = JSON.parse(jsonSchema)

if (!jsonSchema.definitions['FileFormat.File']) {
  console.error('SCHEMA GENERATION FAILURE: Could not find FileFormat.File in the definitions list')
  console.error(jsonSchema)
  process.exit(1)
}

jsonSchema['$ref'] = '#/definitions/FileFormat.File'
if (!process.argv.includes('--check')) console.log(JSON.stringify(jsonSchema, null, 4))
