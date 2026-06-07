@echo off
echo Starting Teacher Assistant Project...

cd backend
start cmd /k "echo Starting Backend... && npm start"

cd ..
cd frontend
start cmd /k "echo Starting Frontend... && npm run dev"

echo Project is starting. Check the newly opened terminal windows.
pause
