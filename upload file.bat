@echo off
setlocal

:: Configuration
set DEST_DIR=/var/www/html/Mikrotik-Billing-Manager

echo ==================================================
echo    Mikrotik Billing Manager - Upload & Deploy
echo ==================================================
echo.

:: Check for SCP
where scp >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: 'scp' command not found. Please install OpenSSH Client or use Git Bash.
    pause
    exit /b 1
)

:: Get Server Details
set /p SERVER_IP="Enter Server IP: "
set /p SERVER_USER="Enter Server Username (e.g. root): "

echo.
echo [1/3] Packing files into deploy_bundle.zip...
:: Remove old zip if exists
if exist deploy_bundle.zip del deploy_bundle.zip

:: Zip files using PowerShell
:: We exclude node_modules, .git, dist, and the nested Billing-Manager folder if it exists to avoid recursion/duplication
powershell -Command "Get-ChildItem -Path . -Exclude 'node_modules','.git','dist','*.zip','Billing-Manager' | Compress-Archive -DestinationPath deploy_bundle.zip -Force"

if not exist deploy_bundle.zip (
    echo Error: Failed to create zip file.
    pause
    exit /b 1
)

echo.
echo [2/3] Uploading to %SERVER_USER%@%SERVER_IP%...
scp deploy_bundle.zip %SERVER_USER%@%SERVER_IP%:/tmp/deploy_bundle.zip

if %errorlevel% neq 0 (
    echo Error: Upload failed. Check your credentials and connection.
    pause
    exit /b 1
)

echo.
echo [3/3] Deploying on server...
:: This command:
:: 1. Creates target dir
:: 2. Sets permissions
:: 3. Unzips
:: 4. Runs install.sh
ssh -t %SERVER_USER%@%SERVER_IP% "sudo mkdir -p %DEST_DIR% && sudo chown -R %SERVER_USER%:%SERVER_USER% %DEST_DIR% && unzip -o /tmp/deploy_bundle.zip -d %DEST_DIR% && rm /tmp/deploy_bundle.zip && cd %DEST_DIR% && chmod +x install.sh && ./install.sh"

echo.
echo Done.
pause
