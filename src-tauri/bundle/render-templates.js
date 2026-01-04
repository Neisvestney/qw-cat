#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'handlebars';
const { compile } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const [, , env, input] = process.argv;

if (!env || !input || !['local', 'remote'].includes(env)) {
  console.error('Usage: node render-templates.js <local|remote> <version>');
  process.exit(1);
}

const templatePath = path.join(__dirname, 'io.github.neisvestney.qw-cat.yml.hbs');

let templateSource;
try {
  templateSource = readFileSync(templatePath, 'utf8');
} catch (err) {
  console.error('Could not read template file:', templatePath);
  console.error(err.message);
  process.exit(1);
}

const template = compile(templateSource);

// Data passed to Handlebars:
let context = {}

if (env == "local") {
  context = {
    local: true,
    version_and_arch: input
  }
} else {
  const githubRelease = await fetch(`https://api.github.com/repos/Neisvestney/qw-cat/releases/tags/${input}`).then(r => r.json())
  const debAmdAsset = githubRelease.assets.find(x => x.name.endsWith("_amd64.deb"))
  const debArmAsset = githubRelease.assets.find(x => x.name.endsWith("_arm64.deb"))

  context = {
    local: false,
    amd: {
      url: debAmdAsset.browser_download_url,
      sha256: debAmdAsset.digest.slice(7)
    },
    arm: {
      url: debArmAsset.browser_download_url,
      sha256: debArmAsset.digest.slice(7)
    }
  }

  console.log(context)
}

const result = template(context);

// Write to file (or you can just console.log(result))
mkdirSync(path.join(__dirname, 'generated'), { recursive: true })
const outputPath = path.join(__dirname, 'generated/io.github.neisvestney.qw-cat.yml');
writeFileSync(outputPath, result, 'utf8');

console.log(`Rendered file written to ${outputPath}`);
