[CmdletBinding()]
param(
    [string]$TemplatePath = $env:RETELL_TEMPLATE_PATH,
    [string]$AgentId = $env:RETELL_AGENT_ID,
    [string]$WebhookUrl = $env:CATALYST_RETELL_WEBHOOK_URL,
    [switch]$SetWebhook,
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$apiKey = $env:RETELL_API_KEY
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw "RETELL_API_KEY is not set. Put the Retell API key in that environment variable; never paste it into this script."
}
if ([string]::IsNullOrWhiteSpace($AgentId)) {
    throw "RETELL_AGENT_ID is not set. Copy the exact Retell Agent ID into that environment variable."
}
if ([string]::IsNullOrWhiteSpace($TemplatePath)) {
    throw "RETELL_TEMPLATE_PATH is not set. Point it to the reviewed private Retell JSON template."
}
if (-not (Test-Path -LiteralPath $TemplatePath -PathType Leaf)) {
    throw "Template file not found: $TemplatePath"
}
if ($SetWebhook -and [string]::IsNullOrWhiteSpace($WebhookUrl)) {
    throw "CATALYST_RETELL_WEBHOOK_URL is required when -SetWebhook is used."
}

$baseUrl = "https://api.retellai.com"
$headers = @{
    Authorization = "Bearer $apiKey"
    Accept = "application/json"
}

function Invoke-RetellRequest {
    param(
        [Parameter(Mandatory = $true)]
        [ValidateSet("GET", "PATCH")]
        [string]$Method,

        [Parameter(Mandatory = $true)]
        [string]$Path,

        [AllowNull()]
        [object]$Body
    )

    $parameters = @{
        Method = $Method
        Uri = "$baseUrl$Path"
        Headers = $headers
        ContentType = "application/json"
    }

    if ($null -ne $Body) {
        $parameters["Body"] = $Body | ConvertTo-Json -Depth 100 -Compress
    }

    Invoke-RestMethod @parameters
}

function Get-PropertyNames {
    param(
        [AllowNull()]
        [object]$Object
    )

    if ($null -eq $Object) {
        return @()
    }

    @($Object.PSObject.Properties | ForEach-Object { $_.Name })
}

function Assert-TemplateContract {
    param(
        [Parameter(Mandatory = $true)]
        [object]$Template
    )

    $requiredAgentFields = @(
        "agent_name",
        "voice_id",
        "language",
        "data_storage_setting",
        "data_storage_retention_days",
        "opt_in_signed_url",
        "end_call_after_silence_ms",
        "max_call_duration_ms",
        "post_call_analysis_model",
        "post_call_analysis_data",
        "pii_config",
        "enable_expressive_mode",
        "enable_backchannel",
        "reminder_trigger_ms",
        "reminder_max_count",
        "stt_mode",
        "allow_user_dtmf",
        "user_dtmf_options",
        "denoising_mode",
        "conversationFlow"
    )

    $agentFields = Get-PropertyNames -Object $Template
    $missingAgentFields = @($requiredAgentFields | Where-Object { $_ -notin $agentFields })
    if ($missingAgentFields.Count -gt 0) {
        throw "Template is missing required agent fields: $($missingAgentFields -join ', ')"
    }

    $requiredFlowFields = @(
        "model_choice",
        "model_temperature",
        "knowledge_base_ids",
        "start_speaker",
        "global_prompt",
        "flex_mode",
        "start_node_id",
        "default_dynamic_variables",
        "nodes"
    )

    $flowFields = Get-PropertyNames -Object $Template.conversationFlow
    $missingFlowFields = @($requiredFlowFields | Where-Object { $_ -notin $flowFields })
    if ($missingFlowFields.Count -gt 0) {
        throw "Template is missing required conversation-flow fields: $($missingFlowFields -join ', ')"
    }

    foreach ($property in $Template.conversationFlow.default_dynamic_variables.PSObject.Properties) {
        if ($property.Value -isnot [string]) {
            throw "Dynamic variable '$($property.Name)' is not a string. Retell requires every dynamic-variable value to be a string."
        }
    }

    $analysisNames = @($Template.post_call_analysis_data | ForEach-Object { $_.name })
    if ($analysisNames.Count -eq 0) {
        throw "Template post_call_analysis_data is empty."
    }
    $duplicateAnalysisNames = @(
        $analysisNames |
            Group-Object |
            Where-Object { $_.Count -gt 1 } |
            ForEach-Object { $_.Name }
    )
    if ($duplicateAnalysisNames.Count -gt 0) {
        throw "Template contains duplicate post-call analysis names: $($duplicateAnalysisNames -join ', ')"
    }
}

$template = Get-Content -LiteralPath $TemplatePath -Raw | ConvertFrom-Json
Assert-TemplateContract -Template $template

$currentAgent = Invoke-RetellRequest -Method "GET" -Path "/get-agent/$AgentId" -Body $null
if ($currentAgent.response_engine.type -ne "conversation-flow") {
    throw "The selected Retell agent is not a conversation-flow agent."
}

$flowId = $currentAgent.response_engine.conversation_flow_id
if ([string]::IsNullOrWhiteSpace($flowId)) {
    throw "The selected Retell agent has no conversation_flow_id."
}

$currentFlow = Invoke-RetellRequest -Method "GET" -Path "/get-conversation-flow/$flowId" -Body $null

$targetVariableNames = Get-PropertyNames -Object $template.conversationFlow.default_dynamic_variables
$currentVariableNames = Get-PropertyNames -Object $currentFlow.default_dynamic_variables
$targetAnalysisNames = @($template.post_call_analysis_data | ForEach-Object { $_.name })
$currentAnalysisNames = @($currentAgent.post_call_analysis_data | ForEach-Object { $_.name })

Write-Host "Retell draft alignment preview"
Write-Host "  Agent: $($currentAgent.agent_name) -> $($template.agent_name)"
Write-Host "  Dynamic Variables: $($currentVariableNames.Count) -> $($targetVariableNames.Count)"
Write-Host "  Post-Call Fields: $($currentAnalysisNames.Count) -> $($targetAnalysisNames.Count)"
Write-Host "  Set Agent-Level Webhook: $SetWebhook"

if (-not $Apply) {
    Write-Host ""
    Write-Host "Dry run only. Re-run with -Apply after reviewing the private template and target."
    exit 0
}

$backupRoot = Join-Path $PSScriptRoot ".retell-backups"
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$currentAgent |
    ConvertTo-Json -Depth 100 |
    Set-Content -LiteralPath (Join-Path $backupRoot "$stamp-agent.json") -Encoding UTF8
$currentFlow |
    ConvertTo-Json -Depth 100 |
    Set-Content -LiteralPath (Join-Path $backupRoot "$stamp-flow.json") -Encoding UTF8

$flowPatch = [ordered]@{
    model_choice = $template.conversationFlow.model_choice
    model_temperature = $template.conversationFlow.model_temperature
    knowledge_base_ids = $template.conversationFlow.knowledge_base_ids
    start_speaker = $template.conversationFlow.start_speaker
    global_prompt = $template.conversationFlow.global_prompt
    flex_mode = $template.conversationFlow.flex_mode
    start_node_id = $template.conversationFlow.start_node_id
    default_dynamic_variables = $template.conversationFlow.default_dynamic_variables
    nodes = $template.conversationFlow.nodes
}

$agentPatch = [ordered]@{
    agent_name = $template.agent_name
    voice_id = $template.voice_id
    language = $template.language
    data_storage_setting = $template.data_storage_setting
    data_storage_retention_days = $template.data_storage_retention_days
    opt_in_signed_url = $template.opt_in_signed_url
    end_call_after_silence_ms = $template.end_call_after_silence_ms
    max_call_duration_ms = $template.max_call_duration_ms
    post_call_analysis_model = $template.post_call_analysis_model
    post_call_analysis_data = $template.post_call_analysis_data
    pii_config = $template.pii_config
    enable_expressive_mode = $template.enable_expressive_mode
    enable_backchannel = $template.enable_backchannel
    reminder_trigger_ms = $template.reminder_trigger_ms
    reminder_max_count = $template.reminder_max_count
    stt_mode = $template.stt_mode
    allow_user_dtmf = $template.allow_user_dtmf
    user_dtmf_options = $template.user_dtmf_options
    denoising_mode = $template.denoising_mode
}

if ($SetWebhook) {
    $agentPatch["webhook_url"] = $WebhookUrl
    $agentPatch["webhook_events"] = @(
        "call_started",
        "call_ended",
        "call_analyzed",
        "transfer_started",
        "transfer_bridged",
        "transfer_cancelled",
        "transfer_ended"
    )
    $agentPatch["webhook_timeout_ms"] = 10000
}

Invoke-RetellRequest -Method "PATCH" -Path "/update-conversation-flow/$flowId" -Body $flowPatch | Out-Null
Invoke-RetellRequest -Method "PATCH" -Path "/update-agent/$AgentId" -Body $agentPatch | Out-Null

$verifiedAgent = Invoke-RetellRequest -Method "GET" -Path "/get-agent/$AgentId" -Body $null
$verifiedFlow = Invoke-RetellRequest -Method "GET" -Path "/get-conversation-flow/$flowId" -Body $null

$verifiedVariableNames = Get-PropertyNames -Object $verifiedFlow.default_dynamic_variables
$missingVariables = @($targetVariableNames | Where-Object { $_ -notin $verifiedVariableNames })
if ($missingVariables.Count -gt 0) {
    throw "Readback failed. Missing dynamic variables: $($missingVariables -join ', ')"
}

$verifiedAnalysisNames = @($verifiedAgent.post_call_analysis_data | ForEach-Object { $_.name })
$missingAnalysisFields = @($targetAnalysisNames | Where-Object { $_ -notin $verifiedAnalysisNames })
if ($missingAnalysisFields.Count -gt 0) {
    throw "Readback failed. Missing post-call fields: $($missingAnalysisFields -join ', ')"
}

if ($verifiedAgent.agent_name -ne $template.agent_name) {
    throw "Readback failed. Agent name did not match the private template."
}
if ($SetWebhook -and $verifiedAgent.webhook_url -ne $WebhookUrl) {
    throw "Readback failed. Agent webhook URL did not match the requested private target."
}

Write-Host ""
Write-Host "Retell draft alignment completed and read back successfully."
Write-Host "No publish, phone-number assignment, carrier route, or Production action was performed."
