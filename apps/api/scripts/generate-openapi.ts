import { mkdir, writeFile } from 'node:fs/promises';
import { OpenApiGeneratorV32 } from '@asteasolutions/zod-to-openapi';
import { registry } from '../src/contracts/openapi.js';

const generator = new OpenApiGeneratorV32(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.2.0',
  info: {
    title: 'TutWithUs AI Receptionist API',
    version: '1.0.0',
    description:
      'Shared browser voice REST and server-sent event contracts. Provider realtime event names remain subject to the Sprint 0 technical spike.',
  },
});
const outputDirectory = new URL('../openapi/', import.meta.url);
const outputFile = new URL('../openapi/openapi.json', import.meta.url);

await mkdir(outputDirectory, { recursive: true });
await writeFile(outputFile, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`Generated ${outputFile.pathname}`);
