# scripts/test-oracle-confirm.ps1
# Quick integration test for the oracle/confirm endpoint.
# Run: powershell -ExecutionPolicy Bypass -File scripts\test-oracle-confirm.ps1

param(
    [string]$BaseUrl   = "http://localhost:3002",
    [string]$OracleKey = "titip_oracle_dev_key",
    [string]$EscrowId  = ""
)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  Titip Protocol -- Oracle Confirm Integration Test"            -ForegroundColor Cyan
Write-Host "  Server: $BaseUrl"                                              -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Health check
Write-Host "[1/4] Health check..." -ForegroundColor Yellow
try {
    $health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -Method GET
    Write-Host "  OK  DB: $($health.db)  Chain: $($health.chain)" -ForegroundColor Green
} catch {
    Write-Host "  FAIL  Server not reachable at $BaseUrl" -ForegroundColor Red
    exit 1
}

# 2. Find a SHIPPED escrow if not provided
if (-not $EscrowId) {
    Write-Host "[2/4] Auto-detecting SHIPPED escrow..." -ForegroundColor Yellow
    $buyerAddr = "GCSIGIFQQR7UQ55EFKSLCPB2CFS7PCMULYFBWEMPXJ6V2FR6RTZDLCRZ"
    $escrows = Invoke-RestMethod -Uri "$BaseUrl/api/user/$buyerAddr/escrows" -Method GET
    $shipped = $escrows.escrows | Where-Object { $_.status -eq "SHIPPED" } | Select-Object -First 1
    if (-not $shipped) {
        Write-Host "  FAIL  No SHIPPED escrow found. Re-run seed first." -ForegroundColor Red
        exit 1
    }
    $EscrowId = $shipped.id
    Write-Host "  OK  Found SHIPPED escrow: $EscrowId (tracking: $($shipped.trackingNumber))" -ForegroundColor Green
} else {
    Write-Host "[2/4] Using provided escrow: $EscrowId" -ForegroundColor Yellow
}

# 3. Verify SHIPPED status
Write-Host "[3/4] Verifying escrow state..." -ForegroundColor Yellow
$before = Invoke-RestMethod -Uri "$BaseUrl/api/escrow/$EscrowId" -Method GET
if ($before.status -ne "SHIPPED") {
    Write-Host "  FAIL  Escrow status is '$($before.status)' -- expected SHIPPED" -ForegroundColor Red
    exit 1
}
Write-Host "  OK  Status: $($before.status) | Tracking: $($before.trackingNumber) | Amount: $($before.amountUsdc) USDC" -ForegroundColor Green

# 4. Call oracle/confirm
Write-Host "[4/4] Calling POST /api/oracle/confirm..." -ForegroundColor Yellow
$body = @{
    escrowId = $EscrowId
    courierResponse = @{
        source         = "test-oracle-confirm.ps1"
        trackingNumber = $before.trackingNumber
        status         = "DELIVERED"
        deliveredAt    = (Get-Date -Format "o")
        note           = "Manual integration test - simulated delivery"
    }
} | ConvertTo-Json -Depth 5

$headers = @{
    "Content-Type"  = "application/json"
    "Authorization" = "Bearer $OracleKey"
}

try {
    $result = Invoke-RestMethod -Uri "$BaseUrl/api/oracle/confirm" -Method POST -Body $body -Headers $headers
    Write-Host "  OK  oracle/confirm response:" -ForegroundColor Green
    $result | ConvertTo-Json | Write-Host -ForegroundColor DarkGray
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    Write-Host "  FAIL  oracle/confirm returned HTTP $statusCode : $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

# 5. Verify final state
Start-Sleep -Milliseconds 500
$after = Invoke-RestMethod -Uri "$BaseUrl/api/escrow/$EscrowId" -Method GET
if ($after.status -ne "DELIVERED") {
    Write-Host "  FAIL  Final status '$($after.status)' -- expected DELIVERED" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Green
Write-Host "  ALL STEPS PASSED"                                               -ForegroundColor Green
Write-Host "  Escrow $EscrowId => DELIVERED"                                  -ForegroundColor Green
Write-Host "  deliveredAt: $($after.deliveredAt)"                             -ForegroundColor Green
Write-Host "  View: $BaseUrl/escrow/$EscrowId"                                -ForegroundColor Green
Write-Host "================================================================" -ForegroundColor Green
Write-Host ""
