# DPAK-UPLOAD v1 over a COM port (Windows PowerShell 5.1+).
# Reference host implementation / hardware test tool — same rules as the
# browser sender (tools/animator/PROTOCOL.md): settle after open, ignore
# non-protocol lines, retry the handshake (port open resets the ESP32).
#
#   powershell -File upload-serial.ps1 -Port COM17 -File ..\..\firmware\data\demo.dpak
param(
  [Parameter(Mandatory=$true)][string]$Port,
  [Parameter(Mandatory=$true)][string]$File,
  [int]$ChunkSize = 1024
)
$ErrorActionPreference = 'Stop'

# --- CRC-32 IEEE (poly 0xEDB88320), compiled C# — PS 5.1 integer ops mangle
# unsigned 32-bit arithmetic (sign extension on -shr), so don't do it in PS.
Add-Type -TypeDefinition @"
public static class DpakCrc32 {
  static readonly uint[] T = new uint[256];
  static DpakCrc32() {
    for (uint i = 0; i < 256; i++) {
      uint c = i;
      for (int k = 0; k < 8; k++) c = ((c & 1) != 0) ? ((c >> 1) ^ 0xEDB88320u) : (c >> 1);
      T[i] = c;
    }
  }
  public static uint Compute(byte[] d, int off, int cnt) {
    uint crc = 0xFFFFFFFFu;
    for (int i = 0; i < cnt; i++) crc = T[(crc ^ d[off + i]) & 0xFF] ^ (crc >> 8);
    return crc ^ 0xFFFFFFFFu;
  }
}
"@
function Get-Crc32([byte[]]$data, [int]$offset, [int]$count) {
  return [long][DpakCrc32]::Compute($data, $offset, $count)
}
# self-check: standard test vector
if (('{0:x8}' -f (Get-Crc32 ([System.Text.Encoding]::ASCII.GetBytes('123456789')) 0 9)) -ne 'cbf43926') {
  throw 'CRC-32 self-check failed'
}

$bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $File))
$total = $bytes.Length
$crcHex = ('{0:x8}' -f (Get-Crc32 $bytes 0 $total))
Write-Host "pack: $File ($total bytes, crc32 $crcHex)"

$sp = New-Object System.IO.Ports.SerialPort $Port,115200,([System.IO.Ports.Parity]::None),8,([System.IO.Ports.StopBits]::One)
$sp.DtrEnable = $false; $sp.RtsEnable = $false
$sp.ReadTimeout = 200
$sp.Open()

function Read-ProtoLine([int]$deadlineMs) {
  # Returns the next complete line, or $null on deadline.
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $sb = New-Object System.Text.StringBuilder
  while ($sw.ElapsedMilliseconds -lt $deadlineMs) {
    try { $b = $sp.ReadByte() } catch [System.TimeoutException] { continue }
    if ($b -lt 0) { continue }
    if ($b -eq 10) { return $sb.ToString().TrimEnd([char]13) }
    [void]$sb.Append([char]$b)
    if ($sb.Length -gt 300) { [void]$sb.Clear() }  # binary/garbage resync
  }
  return $null
}

try {
  # settle for a FIXED 1.5s: port open usually reboots the device; its log
  # (incl. a once-per-second FPS line) never goes quiet, so a bounded drain.
  Write-Host 'settling (device may reboot on port open)...'
  $settle = [System.Diagnostics.Stopwatch]::StartNew()
  while ($settle.ElapsedMilliseconds -lt 1500) {
    $noise = Read-ProtoLine ([int](1500 - $settle.ElapsedMilliseconds))
    if ($null -ne $noise -and $noise.Length) { Write-Host "  ~ $noise" }
  }

  # handshake with retries
  $hs = "DPAK-UPLOAD v1 $total $crcHex`n"
  $hsBytes = [System.Text.Encoding]::ASCII.GetBytes($hs)
  $ok = $false
  for ($attempt = 1; $attempt -le 3 -and -not $ok; $attempt++) {
    Write-Host "> DPAK-UPLOAD v1 $total $crcHex  (attempt $attempt)"
    $sp.Write($hsBytes, 0, $hsBytes.Length)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt 3000) {
      $line = Read-ProtoLine ([int](3000 - $sw.ElapsedMilliseconds))
      if ($null -eq $line) { break }
      if ($line -eq 'OK') { $ok = $true; Write-Host '< OK'; break }
      if ($line.StartsWith('ERR')) { throw "device refused: $line" }
      if ($line.Length) { Write-Host "  ~ $line" }
    }
  }
  if (-not $ok) { throw 'device not responding (no OK after 3 handshakes)' }

  # chunks
  $sent = 0
  while ($sent -lt $total) {
    $len = [Math]::Min($ChunkSize, $total - $sent)
    $frame = New-Object byte[] (2 + $len + 4)
    $frame[0] = $len -band 0xFF; $frame[1] = ($len -shr 8) -band 0xFF
    [Array]::Copy($bytes, $sent, $frame, 2, $len)
    $ccrc = Get-Crc32 $bytes $sent $len
    for ($i = 0; $i -lt 4; $i++) { $frame[2 + $len + $i] = ($ccrc -shr (8 * $i)) -band 0xFF }

    $acked = $false
    for ($try = 1; $try -le 5 -and -not $acked; $try++) {
      $sp.Write($frame, 0, $frame.Length)
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      $resend = $false
      while (-not $acked -and -not $resend) {
        if ($sw.ElapsedMilliseconds -ge 5000) { throw "no ack at $sent/$total" }
        $line = Read-ProtoLine ([int](5000 - $sw.ElapsedMilliseconds))
        if ($null -eq $line) { throw "no ack at $sent/$total" }
        if ($line -eq 'A') { $acked = $true }
        elseif ($line -eq 'R') { $resend = $true; Write-Host "  chunk @$sent rejected, resend ($try)" }
        elseif ($line.StartsWith('ERR')) { throw "device error: $line" }
        elseif ($line.Length) { Write-Host "  ~ $line" }
      }
    }
    if (-not $acked) { throw "chunk @$sent failed after 5 attempts" }
    $sent += $len
    Write-Host ("  {0}/{1} bytes" -f $sent, $total)
  }

  # completion
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  while ($true) {
    if ($sw.ElapsedMilliseconds -ge 10000) { throw 'no DONE within 10s' }
    $line = Read-ProtoLine ([int](10000 - $sw.ElapsedMilliseconds))
    if ($null -eq $line) { throw 'no DONE within 10s' }
    if ($line -eq 'DONE') { Write-Host '< DONE  — /demo.dpak written, pack hot-reloaded'; break }
    if ($line.StartsWith('ERR')) { throw "device error: $line" }
    if ($line.Length) { Write-Host "  ~ $line" }
  }
  Write-Host 'UPLOAD SUCCESS'
}
finally {
  $sp.Close()
}
