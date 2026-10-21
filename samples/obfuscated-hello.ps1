# Demo sample for Detonation Ocean. Refuses to run outside the sandbox.
if ($env:DETONATION_SANDBOX -ne '1' -or -not (Test-Path '/home/dana/Documents')) { exit 0 }

$encoded = 'VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAiAGgAZQBsAGwAbwAiAA=='
pwsh -NoProfile -EncodedCommand $encoded
