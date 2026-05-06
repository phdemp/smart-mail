param(
    [string]$Remote = "origin",
    [string]$Branch = "",
    [switch]$SetUpstream
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
    Write-Host $Message
    exit 1
}

$repoRoot = git rev-parse --show-toplevel 2>$null
if (-not $repoRoot) {
    Fail "This script must be run inside a Git repository."
}

if ([string]::IsNullOrWhiteSpace($Branch)) {
    $Branch = git branch --show-current 2>$null
}

if ([string]::IsNullOrWhiteSpace($Branch)) {
    Fail "Could not determine the current branch. Pass -Branch explicitly."
}

$remotes = @(git remote)
if ($remotes -notcontains $Remote) {
    Fail "Remote '$Remote' is not configured. Add it first, for example: git remote add $Remote <repo-url>"
}

Write-Host "Repository: $repoRoot"
Write-Host "Remote:     $Remote"
Write-Host "Branch:     $Branch"
Write-Host ""
git status --short
Write-Host ""

if ($SetUpstream) {
    git push -u $Remote $Branch
} else {
    git push $Remote $Branch
}
