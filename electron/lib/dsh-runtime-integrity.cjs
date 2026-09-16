const fs = require('node:fs')
const path = require('node:path')

const CRITICAL_DSH_PACKAGES = [
  '@deepseek-ai/dsh',
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-web',
  '@deepseek-ai/dsh-web-frontend',
]

function packagePath(appRoot, packageName) {
  return path.join(appRoot, 'node_modules', ...packageName.split('/'), 'package.json')
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function readBundledDshVersion(appRoot) {
  try {
    return String(readJson(packagePath(appRoot, '@deepseek-ai/dsh')).version || '').trim()
  } catch {
    return ''
  }
}

function inspectDshRuntime(appRoot) {
  const versions = {}
  const issues = []
  for (const packageName of CRITICAL_DSH_PACKAGES) {
    const manifestPath = packagePath(appRoot, packageName)
    try {
      const version = String(readJson(manifestPath).version || '').trim()
      if (!version) throw new Error('缺少 version')
      versions[packageName] = version
    } catch (error) {
      issues.push(`${packageName} 缺失或损坏（${error.message || String(error)}）`)
    }
  }

  const expectedVersion = versions['@deepseek-ai/dsh'] || ''
  for (const [packageName, version] of Object.entries(versions)) {
    if (expectedVersion && version !== expectedVersion) {
      issues.push(`${packageName}=${version}，预期 ${expectedVersion}`)
    }
  }

  const moduleHostPath = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-modules', 'lib', 'index.js')
  const moduleClientPath = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-modules', 'lib', 'client.js')
  const webClientPath = path.join(appRoot, 'node_modules', '@deepseek-ai', 'dsh-client-web', 'lib', 'index.js')
  try {
    const hostSource = fs.readFileSync(moduleHostPath, 'utf8')
    const clientSource = fs.readFileSync(moduleClientPath, 'utf8')
    const webSource = fs.readFileSync(webClientPath, 'utf8')
    const expectsFactory = /createClientModuleSystem/.test(hostSource) || /createClientModuleSystem/.test(webSource)
    const providesFactory = /exports\.createClientModuleSystem\s*=/.test(clientSource)
      || /export\s*\{[^}]*createClientModuleSystem/.test(clientSource)
    const expectsLegacy = /\bClientModuleSystem\b/.test(webSource)
    const providesLegacy = /exports\.ClientModuleSystem\s*=/.test(clientSource)
      || /export\s*\{[^}]*ClientModuleSystem/.test(clientSource)

    if (expectsFactory && !providesFactory) {
      issues.push('dsh-client-modules 宿主需要 createClientModuleSystem，但 client.js 未导出该接口')
    }
    if (!expectsFactory && expectsLegacy && !providesLegacy) {
      issues.push('dsh-client-web 需要 ClientModuleSystem，但 client.js 未导出该接口')
    }
    if (!expectsFactory && !expectsLegacy) {
      issues.push('无法识别 dsh-client-modules 的 bootstrap 接口')
    }
  } catch (error) {
    issues.push(`无法校验浏览器端 bootstrap 接口（${error.message || String(error)}）`)
  }

  return {
    ok: issues.length === 0,
    expectedVersion,
    versions,
    issues,
  }
}

function assertDshRuntimeIntegrity(appRoot) {
  const report = inspectDshRuntime(appRoot)
  if (!report.ok) {
    throw new Error(`内置 DSH 运行时文件不完整或版本混用：${report.issues.join('；')}。请覆盖安装当前版本 Studio。`)
  }
  return report
}

module.exports = {
  CRITICAL_DSH_PACKAGES,
  assertDshRuntimeIntegrity,
  inspectDshRuntime,
  readBundledDshVersion,
}
