import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Recursively scans a directory and builds a file tree
 * @param {string} dirPath - Absolute path to directory
 * @param {string} relativePath - Path relative to project root
 * @returns {Array<Object>} Array of file/folder objects
 */
function buildFileTree(dirPath, relativePath = '') {
  const items = fs.readdirSync(dirPath);
  const tree = [];

  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const relPath = path.join(relativePath, item);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      // Skip common directories that shouldn't be displayed
      if (['node_modules', '.git', 'dist', 'build'].includes(item)) {
        continue;
      }

      tree.push({
        type: 'folder',
        name: item,
        path: relPath,
        children: buildFileTree(fullPath, relPath),
      });
    } else if (stats.isFile()) {
      // Only include code files
      const ext = path.extname(item);
      const codeExtensions = ['.js', '.ts', '.jsx', '.tsx', '.vue', '.css', '.scss', '.json', '.md'];

      if (codeExtensions.includes(ext)) {
        tree.push({
          type: 'file',
          name: item,
          path: relPath,
          extension: ext.slice(1),
        });
      }
    }
  }

  // Sort: folders first, then files, alphabetically
  return tree.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Reads metadata.json if it exists, otherwise returns defaults
 * @param {string} projectPath - Absolute path to project directory
 * @param {string} projectId - Project ID
 * @returns {Object} Metadata object
 */
function readMetadata(projectPath, projectId) {
  const metadataPath = path.join(projectPath, 'metadata.json');

  if (fs.existsSync(metadataPath)) {
    try {
      const content = fs.readFileSync(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to parse metadata.json for ${projectId}:`, error.message);
    }
  }

  // Return defaults if metadata doesn't exist
  return {
    id: projectId,
    title: projectId.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    summary: '',
    featured: [],
    annotations: {},
  };
}

/**
 * Discovers all code sample projects in src/code-samples/
 * @returns {Array<Object>} Array of project objects with file trees
 */
export function discoverCodeSamples() {
  // In build/dev mode, __dirname points to src/utils
  // In production, we need to go up from dist
  let samplesDir = path.resolve(__dirname, '../code-samples');

  // Fallback for different build contexts
  if (!fs.existsSync(samplesDir)) {
    samplesDir = path.resolve(process.cwd(), 'src/code-samples');
  }

  if (!fs.existsSync(samplesDir)) {
    console.warn('Code samples directory not found. Tried:', samplesDir);
    return [];
  }

  const projects = [];
  const items = fs.readdirSync(samplesDir);

  for (const item of items) {
    const projectPath = path.join(samplesDir, item);
    const stats = fs.statSync(projectPath);

    // Skip non-directories and hidden files
    if (!stats.isDirectory() || item.startsWith('.')) {
      continue;
    }

    const metadata = readMetadata(projectPath, item);
    const fileTree = buildFileTree(projectPath, '');

    // Find README.md if it exists
    const readmePath = path.join(projectPath, 'README.md');
    const hasReadme = fs.existsSync(readmePath);

    projects.push({
      id: item,
      ...metadata,
      fileTree,
      hasReadme,
      path: item,
    });
  }

  return projects.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Reads the content of a specific file from a code sample project
 * @param {string} projectId - Project ID
 * @param {string} filePath - Relative path to file within project
 * @returns {string|null} File content or null if not found
 */
export function readCodeFile(projectId, filePath) {
  // Try multiple possible paths
  let samplesDir = path.resolve(__dirname, '../code-samples');

  if (!fs.existsSync(samplesDir)) {
    samplesDir = path.resolve(process.cwd(), 'src/code-samples');
  }

  const fullPath = path.join(samplesDir, projectId, filePath);

  try {
    if (!fs.existsSync(fullPath)) {
      return null;
    }

    // Security check: ensure path doesn't escape code-samples directory
    const realPath = fs.realpathSync(fullPath);
    const realSamplesDir = fs.realpathSync(samplesDir);

    if (!realPath.startsWith(realSamplesDir)) {
      console.error('Path traversal attempt blocked:', filePath);
      return null;
    }

    return fs.readFileSync(fullPath, 'utf-8');
  } catch (error) {
    // Silently return null - files might not exist in all contexts
    return null;
  }
}
