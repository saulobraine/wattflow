# G:/projetos/wattflow/scripts/check-squad-tasks.ps1
# Rotina de monitoramento e auto-orquestracao do squad WattFlow

$planPath = "G:\projetos\wattflow\docs\security-remediation-plan.md"
$squad = @(
    @{ Name = "Dev Sênior - ApexDev"; Role = "Implementação Backend/Core" },
    @{ Name = "DevOps Engineer - PipelineForge"; Role = "Infra/Docker/CI-CD" },
    @{ Name = "Dev Frontend - PixelCraft"; Role = "Frontend/UI" },
    @{ Name = "Testes Unitários - UnitTestEngine"; Role = "Testes Unitários/Integração" },
    @{ Name = "Testes E2E - E2EGuardian"; Role = "Testes E2E/Playwright" },
    @{ Name = "Code Reviewer - Sentinel"; Role = "Code Review & Segurança" },
    @{ Name = "Analista de QA - Certifier"; Role = "QA & Homologação" },
    @{ Name = "GitHub Manager - GitOps"; Role = "Git & Commits" }
)

$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Write-Host "=========================================================="
Write-Host "📡 [MAESTRO ROUTINE] Auditoria de Status & Auto-Orquestração"
Write-Host "Horário: $timestamp"
Write-Host "=========================================================="

$pendingCount = 0
if (Test-Path $planPath) {
    $pendingCount = (Select-String -Path $planPath -Pattern "^- \[ \]" | Measure-Object).Count
    Write-Host "📋 Itens pendentes no Plano de Remediação: $pendingCount"
}

$idleAgents = @()

foreach ($member in $squad) {
    $agent = $member.Name
    Write-Host "`n🔍 Verificando [$agent] ($($member.Role))..."
    try {
        $terminalOutput = maestri check "$agent" 2>&1
        $outputStr = "$terminalOutput"
        
        $isBusy = $outputStr -match "(Thought for|Ran \d+ command|Reading file|Thinking\.\.\.|Running\.\.\.|Generating\.\.\.)"
        
        if ($isBusy) {
            Write-Host "⚙️ [$agent] EM EXECUÇÃO ATIVA."
        } else {
            Write-Host "⏸️ [$agent] OCIOSO / AGUARDANDO."
            $idleAgents += $agent
            $res = maestri ask "$agent" "Status check de rotina: Você concluiu sua última tarefa? Se estiver livre e houver pendências para sua especialidade em docs/security-remediation-plan.md, informe o Maestro imediatamente." 2>&1
            $lastLine = ($res -split "`n" | Where-Object { $_.Trim() -ne "" })[-3..-1] -join "`n"
            Write-Host "   ➔ Retorno: $lastLine"
        }
    } catch {
        Write-Host "⚠️ Erro ao verificar [$agent]: $_"
    }
}

if ($idleAgents.Count -gt 0 -and $pendingCount -gt 0) {
    Write-Host "`n🚨 [AÇÃO DE ORQUESTRAÇÃO NECESSÁRIA]"
    Write-Host "Existem $pendingCount tarefas pendentes no plano e $($idleAgents.Count) terminais ociosos:"
    $idleAgents | ForEach-Object { Write-Host "  - $_" }
    Write-Host "Maestro: despache a próxima etapa do pipeline para os especialistas livres."
}

Write-Host "`n=========================================================="
Write-Host "✅ Ciclo de verificação concluído."
Write-Host "=========================================================="
