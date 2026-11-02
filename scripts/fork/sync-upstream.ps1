#Requires -Version 7.0
<#
.SYNOPSIS
    Rebases this fork onto the upstream Folo branch and optionally rebuilds the Windows app.

.DESCRIPTION
    The fork only adds local patches (see README.md in this folder). Keeping them on a branch and
    rebasing on top of upstream means a new upstream release is one command away, and the fork never
    needs a merge commit.

.EXAMPLE
    pwsh scripts/fork/sync-upstream.ps1
    pwsh scripts/fork/sync-upstream.ps1 -Install -Typecheck
    pwsh scripts/fork/sync-upstream.ps1 -Build
#>
[CmdletBinding()]
param(
    # Branch that carries the local patches
    [string]$PatchBranch = "local-enhance",
    [string]$UpstreamRemote = "upstream",
    [string]$UpstreamUrl = "https://github.com/RSSNext/Folo.git",
    [string]$UpstreamBranch = "dev",
    # Install dependencies when the lockfile changed (always installs when passed)
    [switch]$Install,
    # Run the typecheck of the desktop app after the rebase
    [switch]$Typecheck,
    # Build the Windows installer after the rebase
    [switch]$Build
)

$ErrorActionPreference = "Stop"

function Write-Step($message) {
    Write-Host ""
    Write-Host "==> $message" -ForegroundColor Cyan
}

function Invoke-Git {
    git @args
    if ($LASTEXITCODE -ne 0) {
        throw "git $($args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

<#
The machine's global `pnpm` shim is broken here, but `corepack pnpm` always resolves the version
declared in package.json. Every package manager call goes through it.
#>
function Invoke-Pnpm {
    $corepack = Get-Command corepack -ErrorAction SilentlyContinue
    if ($corepack) {
        corepack pnpm @args
    }
    else {
        pnpm @args
    }
    if ($LASTEXITCODE -ne 0) {
        throw "pnpm $($args -join ' ') failed with exit code $LASTEXITCODE"
    }
}

$repoRoot = git rev-parse --show-toplevel
Set-Location $repoRoot

Write-Step "Checking the working tree"
if (git status --porcelain) {
    throw "The working tree has uncommitted changes. Commit or stash them before syncing."
}

Write-Step "Preparing the upstream remote ($UpstreamRemote)"
if ((git remote) -notcontains $UpstreamRemote) {
    Invoke-Git remote add $UpstreamRemote $UpstreamUrl
}

Invoke-Git fetch $UpstreamRemote --prune --tags
$upstreamRef = "$UpstreamRemote/$UpstreamBranch"
$upstreamHead = git rev-parse --short $upstreamRef

Write-Step "Rebasing $PatchBranch onto $upstreamRef ($upstreamHead)"
if ((git branch --show-current) -ne $PatchBranch) {
    Invoke-Git checkout $PatchBranch
}

$patchCount = git rev-list --count "$upstreamRef..HEAD"
$lockBefore = git rev-parse --quiet --verify "HEAD:pnpm-lock.yaml"

Write-Host "Local patches on top of upstream: $patchCount"

git rebase $upstreamRef
if ($LASTEXITCODE -ne 0) {
    $conflicts = git diff --name-only --diff-filter=U
    git rebase --abort
    Write-Host ""
    Write-Host "Rebase stopped, nothing was changed." -ForegroundColor Yellow
    if ($conflicts) {
        Write-Host "Conflicting files:" -ForegroundColor Yellow
        $conflicts | ForEach-Object { Write-Host "  $_" }
    }
    Write-Host ""
    Write-Host "Resolve them by hand (see README.md), then run this script again."
    exit 1
}

$lockAfter = git rev-parse --quiet --verify "HEAD:pnpm-lock.yaml"
$lockChanged = $lockBefore -ne $lockAfter

Write-Step "Sync finished"
Write-Host "Upstream: $upstreamRef @ $upstreamHead"
if ($lockChanged) {
    Write-Host "The lockfile changed upstream, dependencies need to be installed." -ForegroundColor Yellow
}

if ($Install -or $lockChanged) {
    Write-Step "Installing dependencies"
    # The root postinstall builds the workspace packages, which is not needed for the app itself and
    # fails on machines whose global pnpm does not match the pinned version.
    Invoke-Pnpm install --config.pm-on-fail=ignore
}

if ($Typecheck) {
    Write-Step "Typechecking the desktop app"
    Push-Location apps/desktop/layer/main
    Invoke-Pnpm exec tsc
    Pop-Location
    Push-Location apps/desktop/layer/renderer
    Invoke-Pnpm exec tsc --noEmit
    Pop-Location
    Write-Host "Typecheck passed" -ForegroundColor Green
}

if ($Build) {
    Write-Step "Building the Windows app"
    Push-Location apps/desktop
    Invoke-Pnpm exec electron-vite build
    Invoke-Pnpm exec electron-forge make
    Pop-Location
    Write-Host "Installer written to apps/desktop/out/make" -ForegroundColor Green
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
