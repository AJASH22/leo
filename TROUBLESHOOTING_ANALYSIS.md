# Miruro Plugin Troubleshooting Analysis

## Issues Identified

### 1. Anime Images/Posters
**Problem**: Images missing or showing incorrect images in the UI
**Root Cause Analysis**:
- Fallback data uses Anilist CDN URLs directly (hardcoded)
- The `load` function doesn't fetch real poster data when Anilist is down
- No proper fallback image logic for missing images
- URL format issues with special characters in titles

**Current Implementation**:
- getHome/search use hardcoded Anilist image URLs
- load function tries to fetch from Anilist but fails silently with empty poster
- No fallback placeholder images defined

### 2. Organization/UI
**Problem**: Anime data and UI not properly organized
**Root Cause Analysis**:
- pageData structure returns raw categories (Trending, Popular, Upcoming)
- No consistent metadata mapping across functions
- Episode generation doesn't check actual episode data
- Missing consistent fields across all MultimediaItem objects

**Current Implementation**:
- getHome returns 3 categories with 5 items each (hardcoded)
- search returns 4 fixed results (hardcoded)
- load creates episodes without actual episode data
- No normalization of anime data structure

### 3. JSON Files
**Problem**: JSON structure doesn't match expected format
**Root Cause Analysis**:
- plugin.json is minimal and correct
- dist/plugins.json points to correct plugin URL
- repo.json structure is correct
- No validation of MultimediaItem/Episode schema compliance

**Current Implementation**:
- plugin.json has correct structure
- dist/plugins.json references are correct
- Built plugin bundle may not preserve correct JSON structure

### 4. Refresh/Update System
**Problem**: Data/images stale after refresh
**Root Cause Analysis**:
- All data is hardcoded in plugin.js (fallback data)
- No API retry logic when services come back online
- No cache invalidation strategy
- Fallback data never updates

**Current Implementation**:
- getHome always returns same 15 hardcoded anime
- search always returns same 4 hardcoded results
- load generates 1 hardcoded episode when data unavailable
- No mechanism to check if APIs are back online

### 5. Repository Integration
**Problem**: Repo data not flowing correctly through system
**Root Cause Analysis**:
- Plugin is built and bundled correctly
- plugins.json points to correct URL
- The issue is the hardcoded fallback data is too limited
- Real data should come from trying APIs first, then fallback

**Current Implementation**:
- repo.json structure is correct
- plugins.json structure is correct
- plugin.js is self-contained and doesn't integrate with real data sources

## Solutions Strategy

### Phase 1: Data Source Enhancement
- Implement proper API retry logic with exponential backoff
- Create comprehensive fallback dataset (50+ anime instead of 15)
- Add proper image URL validation and CDN selection
- Implement image placeholder URLs for missing data

### Phase 2: Data Structure Normalization
- Ensure all MultimediaItem objects have consistent fields
- Add proper episode count handling
- Implement genre/tag normalization
- Add year/date handling for all entries

### Phase 3: Caching & Refresh Strategy
- Add TTL-based cache for API responses
- Implement stale-while-revalidate pattern
- Add mechanism to detect when APIs come back online
- Implement proper cache invalidation

### Phase 4: Testing & Verification
- Test getHome, search, load, loadStreams with fallback data
- Verify image URLs are valid and load
- Test refresh behavior
- Verify JSON structure compliance

## Implementation Order
1. Enhance fallback data with proper image URLs and more entries
2. Add API retry logic with proper fallbacks
3. Normalize data structure across all functions
4. Test and verify all flows
5. Push to GitHub and verify workflow
