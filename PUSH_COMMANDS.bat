@echo off
REM Miruro Plugin - GitHub Push Commands
REM Run these commands in Command Prompt or PowerShell

cd C:\Users\liome\my-repo

git add -A

git commit -m "feat: miruro plugin for skystream - anilist + consumet streams

- Implement getHome using Anilist GraphQL for trending/popular/upcoming anime
- Implement search with Anilist GraphQL query
- Implement load with full anime details, episodes (season 0 for movies, season 1 for series), cast, and recommendations
- Implement loadStreams using Consumet Meta API for video sources
- All 4 functions tested and passing with skystream CLI
- Proper JSON serialization with correct headers for streaming"

git push -u origin main

REM After push completes (wait ~30 seconds), your repo.json will be available at:
REM https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO_NAME/main/dist/repo.json
