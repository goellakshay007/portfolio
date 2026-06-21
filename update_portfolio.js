import fs from 'fs';
import path from 'path';
import Parser from 'rss-parser';

// Config
const FEED_URL = 'https://www.behance.net/feeds/user?username=https://www.behance.net/lakshaygoel15';
const PROJECTS_FILE = path.join(process.cwd(), 'src', 'portfolio-data.js');
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const parser = new Parser();

// Helper to extract the first image source from HTML content
function extractImageSrc(htmlContent) {
  if (!htmlContent) return '';
  const imgRegex = /<img[^>]+src=["']([^"']+)["']/i;
  const match = htmlContent.match(imgRegex);
  return match ? match[1] : '';
}

// Local helper to generate clean tags if API key is not present or doesn't return any
function getFallbackTags(title, defaultTags) {
  const lowercaseTitle = title.toLowerCase();
  const suggested = [];
  if (lowercaseTitle.includes('brand') || lowercaseTitle.includes('identity')) {
    suggested.push('Brand Identity');
  }
  if (lowercaseTitle.includes('logo')) {
    suggested.push('Logo Design');
  }
  if (lowercaseTitle.includes('packaging')) {
    suggested.push('Packaging Design');
  }
  if (lowercaseTitle.includes('graphic') || lowercaseTitle.includes('poster') || lowercaseTitle.includes('visual')) {
    suggested.push('Graphics');
  }
  if (lowercaseTitle.includes('system') || lowercaseTitle.includes('grid')) {
    suggested.push('Design System');
  }
  if (lowercaseTitle.includes('product') || lowercaseTitle.includes('industrial') || lowercaseTitle.includes('perfume')) {
    suggested.push('Product Design');
  }
  if (suggested.length === 0) {
    return defaultTags && defaultTags.length > 0 ? defaultTags : ['Creative Work'];
  }
  return suggested;
}

// AI Evaluation function using Gemini API
async function evaluateProjectAI(title, tags) {
  if (!GEMINI_API_KEY) {
    console.warn('⚠️  GEMINI_API_KEY environment variable is not defined. Defaulting evaluation to "true".');
    return { isHighTier: true, tags: getFallbackTags(title, tags) };
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
  
  const prompt = `
  You are an expert design director evaluating a multidisciplinary designer's portfolio.
  Analyze the following project details:
  - Title: "${title}"
  - Tags/Categories: "${tags.join(', ')}"
  
  Evaluate if this project matches high-tier, professional design work, specifically in the areas of Brand Identity, Design Systems, Typography, Graphics, or Content Systems.
  Also propose 1-2 clean, high-tier visual category tags for this project (e.g. "Brand Identity", "Design System", "Graphics", "Packaging Design", "Editorial").
  
  Respond strictly with a JSON object in this format:
  {
    "is_high_tier": true,
    "suggested_tags": ["Brand Identity", "Design System"]
  }
  `;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini API responded with status ${response.status}`);
    }

    const data = await response.json();
    const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (responseText) {
      const result = JSON.parse(responseText.trim());
      console.log(`🤖 AI evaluation result for "${title}": is_high_tier = ${result.is_high_tier}, tags = ${result.suggested_tags?.join(', ')}`);
      return {
        isHighTier: !!result.is_high_tier,
        tags: result.suggested_tags && result.suggested_tags.length > 0 ? result.suggested_tags : getFallbackTags(title, tags)
      };
    }
  } catch (error) {
    console.error(`❌ AI evaluation failed for "${title}":`, error.message);
  }

  // Fallback if API fails
  return { isHighTier: true, tags: getFallbackTags(title, tags) };
}

async function run() {
  console.log('🔄 Starting Behance RSS feed update process...');
  
  // 1. Read existing profileData using dynamic import
  console.log(`📂 Loading existing profileData from: ${PROJECTS_FILE}`);
  let profileData;
  try {
    // Dynamic import needs absolute path or relative file URL in Windows Node environment
    const fileUrl = 'file:///' + PROJECTS_FILE.replace(/\\/g, '/');
    const dataModule = await import(fileUrl);
    profileData = dataModule.profileData;
  } catch (e) {
    console.error('❌ Failed to load existing portfolio-data.js:', e.message);
    process.exit(1);
  }

  const projects = profileData.projects || [];
  const existingUrls = new Set(projects.map(p => p.link));
  console.log(`📊 Loaded ${projects.length} existing projects from portfolio-data.js`);

  // 2. Fetch and parse Behance RSS Feed
  let feed;
  let targetFeedUrl = FEED_URL;
  try {
    const urlObj = new URL(FEED_URL);
    const usernameParam = urlObj.searchParams.get('username');
    if (usernameParam && usernameParam.startsWith('http')) {
      const cleanUsername = usernameParam.split('/').filter(Boolean).pop();
      urlObj.searchParams.set('username', cleanUsername);
      targetFeedUrl = urlObj.toString();
      console.log(`🧹 Sanitized feed URL to: ${targetFeedUrl}`);
    }
  } catch (err) {
    console.warn('⚠️  Could not parse FEED_URL as URL object, using raw URL.', err.message);
  }

  try {
    console.log(`🌐 Fetching RSS feed from: ${targetFeedUrl}`);
    feed = await parser.parseURL(targetFeedUrl);
  } catch (error) {
    console.error('❌ Failed to fetch or parse RSS feed:', error.message);
    process.exit(1);
  }

  console.log(`📥 Parsed ${feed.items.length} items from RSS feed.`);

  let addedCount = 0;

  // 3. Process new feed items
  for (const item of feed.items) {
    const projectUrl = item.link;
    const title = item.title;
    
    // Prevent duplicate entries
    if (existingUrls.has(projectUrl)) {
      continue;
    }

    console.log(`✨ Found new project candidate: "${title}"`);

    const imageLink = extractImageSrc(item.content || item.description);
    const tags = item.categories || [];

    // Run AI Evaluation
    const evalResult = await evaluateProjectAI(title, tags);

    if (evalResult.isHighTier) {
      const newProject = {
        id: Date.now() + Math.floor(Math.random() * 1000),
        title,
        category: evalResult.tags[0] || 'Design',
        link: projectUrl,
        image: imageLink || 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?q=80&w=800',
        tags: evalResult.tags
      };

      projects.unshift(newProject); // Prepend new high-tier projects to the top
      existingUrls.add(projectUrl);
      addedCount++;
      console.log(`✅ Appended "${title}" to projects list.`);
    } else {
      console.log(`⏩ Skipped "${title}" (did not meet high-tier design criteria).`);
    }
  }

  // 4. Save updated profileData back to disk if updates occurred
  if (addedCount > 0) {
    try {
      profileData.projects = projects;
      const fileContent = `export const profileData = ${JSON.stringify(profileData, null, 2)};\n`;
      fs.writeFileSync(PROJECTS_FILE, fileContent, 'utf-8');
      console.log(`💾 Successfully updated portfolio-data.js. Added ${addedCount} new projects.`);
    } catch (error) {
      console.error('❌ Failed to write update to portfolio-data.js:', error);
      process.exit(1);
    }
  } else {
    console.log('ℹ️  No new projects were added to the list.');
  }
}

run();
