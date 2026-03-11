import fs from 'node:fs'
import path from 'node:path'

const RELEVANT_HOOK_NAMES = ['commit-msg', 'prepare-commit-msg', 'pre-commit']
const RELEVANT_CONFIG_FILES = [
  'commitlint.config.js',
  'commitlint.config.cjs',
  'commitlint.config.mjs',
  'commitlint.config.ts',
  '.commitlintrc',
  '.commitlintrc.json',
  '.commitlintrc.js',
  '.commitlintrc.cjs',
  '.commitlintrc.mjs',
  '.commitlintrc.yaml',
  '.commitlintrc.yml'
]
const MAX_FILE_SNIPPET = 1200
const MAX_PACKAGE_SNIPPET = 1600
const MAX_SUMMARY_LENGTH = 4000

function unique(values) {
  return [...new Set(values)]
}

function fileExists(filePath) {
  try {
    return fs.statSync(filePath).isFile()
  } catch {
    return false
  }
}

function readTextSnippet(filePath, limit) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n').trim()
  if (!text) {
    return ''
  }

  if (text.length <= limit) {
    return text
  }

  return `${text.slice(0, limit)}\n...<truncated>`
}

function collectHookFiles(context) {
  const candidateDirs = []

  if (context.hasHuskyFolder) {
    candidateDirs.push(path.resolve(context.topLevelPath, '.husky'))
  }

  if (context.hasHookPath) {
    candidateDirs.push(context.hookPath)
  }

  return unique(candidateDirs)
    .flatMap((dirPath) => RELEVANT_HOOK_NAMES.map((fileName) => path.resolve(dirPath, fileName)))
    .filter(fileExists)
}

function collectConfigFiles(topLevelPath) {
  return RELEVANT_CONFIG_FILES
    .map((fileName) => path.resolve(topLevelPath, fileName))
    .filter(fileExists)
}

function extractPackageJsonSnippet(topLevelPath) {
  const packageJsonPath = path.resolve(topLevelPath, 'package.json')
  if (!fileExists(packageJsonPath)) {
    return ''
  }

  try {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
    const relevant = {}
    const scripts = Object.entries(pkg.scripts || {})
      .filter(([name]) => /commit|lint|husky/i.test(name))
      .slice(0, 8)

    if (scripts.length) {
      relevant.scripts = Object.fromEntries(scripts)
    }

    if (pkg.commitlint && typeof pkg.commitlint === 'object') {
      relevant.commitlint = pkg.commitlint
    }

    if (pkg.husky && typeof pkg.husky === 'object') {
      relevant.husky = pkg.husky
    }

    if (pkg['lint-staged'] && typeof pkg['lint-staged'] === 'object') {
      relevant['lint-staged'] = pkg['lint-staged']
    }

    if (pkg.config?.commitizen && typeof pkg.config.commitizen === 'object') {
      relevant.commitizen = pkg.config.commitizen
    }

    if (!Object.keys(relevant).length) {
      return ''
    }

    const text = JSON.stringify(relevant, null, 2)
    if (text.length <= MAX_PACKAGE_SNIPPET) {
      return text
    }

    return `${text.slice(0, MAX_PACKAGE_SNIPPET)}\n...<truncated>`
  } catch {
    return ''
  }
}

function buildFileSection(topLevelPath, filePath, limit = MAX_FILE_SNIPPET) {
  const snippet = readTextSnippet(filePath, limit)
  if (!snippet) {
    return ''
  }

  return `[${path.relative(topLevelPath, filePath) || path.basename(filePath)}]\n${snippet}`
}

function truncateSummary(text) {
  if (text.length <= MAX_SUMMARY_LENGTH) {
    return text
  }

  return `${text.slice(0, MAX_SUMMARY_LENGTH)}\n\n...<truncated>`
}

export function scanCommitConventions(context) {
  const hookFiles = collectHookFiles(context)
  const hookSections = hookFiles
    .map((filePath) => buildFileSection(context.topLevelPath, filePath))
    .filter(Boolean)

  const configFiles = collectConfigFiles(context.topLevelPath)
  const configSections = configFiles
    .map((filePath) => buildFileSection(context.topLevelPath, filePath))
    .filter(Boolean)

  const packageJsonSnippet = extractPackageJsonSnippet(context.topLevelPath)
  const sections = []

  if (hookSections.length) {
    sections.push(`Relevant Git hooks:\n${hookSections.join('\n\n')}`)
  }

  if (configSections.length) {
    sections.push(`Relevant commit config files:\n${configSections.join('\n\n')}`)
  }

  if (packageJsonSnippet) {
    sections.push(`Relevant package.json fields:\n[package.json]\n${packageJsonSnippet}`)
  }

  return {
    hasConventions: sections.length > 0,
    summary: truncateSummary(sections.join('\n\n')),
    sources: [
      ...hookFiles.map((filePath) => path.relative(context.topLevelPath, filePath) || path.basename(filePath)),
      ...configFiles.map((filePath) => path.relative(context.topLevelPath, filePath) || path.basename(filePath)),
      ...(packageJsonSnippet ? ['package.json'] : [])
    ]
  }
}
