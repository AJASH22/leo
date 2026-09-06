# Push Instructions for Miruro Plugin

## Files Changed
- `plugin.json` - Updated with miruro.bz baseUrl
- `plugin.js` - Complete miruro plugin implementation with all 4 functions

## Commit Message
```
feat: miruro plugin for skystream - anilist + consumet streams

- Implement getHome using Anilist GraphQL for trending/popular/upcoming anime
- Implement search with Anilist GraphQL query
- Implement load with full anime details, episodes (season 0 for movies, season 1 for series), cast, and recommendations
- Implement loadStreams using Consumet Meta API for video sources
- All 4 functions tested and passing with skystream CLI
- Proper JSON serialization with correct headers for streaming
```

## Commands to Run (in your terminal/git bash)

```bash
cd C:\Users\liome\my-repo\miruro
git add -A
git commit -m "feat: miruro plugin for skystream - anilist + consumet streams

- Implement getHome using Anilist GraphQL for trending/popular/upcoming anime
- Implement search with Anilist GraphQL query
- Implement load with full anime details, episodes (season 0 for movies, season 1 for series), cast, and recommendations
- Implement loadStreams using Consumet Meta API for video sources
- All 4 functions tested and passing with skystream CLI
- Proper JSON serialization with correct headers for streaming"
git push -u origin main
```

## After Push
Once pushed to GitHub, the GitHub Actions workflow will run (takes ~30 seconds).

After the workflow completes, your raw repo.json link will be:
```
https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO_NAME/main/dist/repo.json
```

Update the `repo.json` file in your project with this URL in the `pluginLists` array.
