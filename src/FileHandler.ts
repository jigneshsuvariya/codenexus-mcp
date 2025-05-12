import { promises as fs, constants as fsConstants } from 'fs';
import path from 'path';
import type { IFileHandler } from './interfaces.js';

const DEFAULT_MEMORY_FILE = 'memory.json';

interface Identifiable {
  id: string;
  [key: string]: any; // Allow other properties
}

export class FileHandler implements IFileHandler {
  private memoryFilePath: string;

  constructor(filePath?: string) {
    const envPath = process.env.MEMORY_FILE_PATH;
    let determinedPath: string;

    if (filePath) {
      determinedPath = filePath;
    } else if (envPath && envPath.trim() !== '') {
      determinedPath = envPath;
    } else {
      determinedPath = DEFAULT_MEMORY_FILE;
    }

    this.memoryFilePath = path.isAbsolute(determinedPath)
      ? determinedPath
      : path.resolve(process.cwd(), determinedPath);

    // console.log(`[FileHandler] Initialized with memory file path: ${this.memoryFilePath}`);
  }

  private async ensureDirectoryExists(): Promise<void> {
    const dir = path.dirname(this.memoryFilePath);
    try {
      await fs.access(dir, fsConstants.F_OK);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(dir, { recursive: true });
        // console.log(`[FileHandler] Created directory: ${dir}`);
      } else {
        throw error;
      }
    }
  }

  async loadData(): Promise<string[]> {
    // console.log(`[FileHandler] Loading data from ${this.memoryFilePath}`);
    try {
      const data = await fs.readFile(this.memoryFilePath, 'utf-8');
      return data.split('\n').filter(line => line.trim() !== '');
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // console.warn(`[FileHandler] File not found: ${this.memoryFilePath}. Returning empty data.`);
        return [];
      }
      console.error(`[FileHandler] Error loading data from ${this.memoryFilePath}:`, error);
      throw error;
    }
  }

  async saveData(lines: string[]): Promise<void> {
    // console.log(`[FileHandler] Saving ${lines.length} lines to ${this.memoryFilePath}`);
    await this.ensureDirectoryExists();
    const content = lines.join('\n') + (lines.length > 0 ? '\n' : '');
    try {
      await fs.writeFile(this.memoryFilePath, content, 'utf-8');
      // console.log('[FileHandler] Data saved successfully.');
    } catch (error) {
      console.error(`[FileHandler] Error saving data to ${this.memoryFilePath}:`, error);
      throw error;
    }
  }

  async appendLine(line: string): Promise<void> {
    if (!line || line.trim() === '') {
      // console.log('[FileHandler] Attempted to append empty line. Skipping.');
      return;
    }
    // console.log(`[FileHandler] Appending line to ${this.memoryFilePath}`);
    await this.ensureDirectoryExists();
    try {
      await fs.appendFile(this.memoryFilePath, line + '\n', 'utf-8');
      // console.log('[FileHandler] Line appended successfully.');
    } catch (error) {
      console.error(`[FileHandler] Error appending line to ${this.memoryFilePath}:`, error);
      throw error;
    }
  }

  // NOTE: Granular updates are deferred. This is a basic, less efficient implementation.
  async updateLineById(id: string, newLine: string): Promise<void> {
    if (!id || !newLine) {
      // console.warn('[FileHandler] updateLineById: ID or newLine is empty. Skipping.');
      return;
    }
    // console.warn('[FileHandler] updateLineById is inefficient (reads and writes entire file).');
    const lines = await this.loadData();
    let found = false;
    const updatedLines = lines.map(line => {
      try {
        const item: Identifiable = JSON.parse(line);
        if (item.id === id) {
          found = true;
          return newLine;
        }
      } catch (error) {
        // console.warn(`[FileHandler] Error parsing line during update: ${line.substring(0,100)}...`, error);
      }
      return line;
    });

    if (!found) {
      // console.warn(`[FileHandler] updateLineById: ID '${id}' not found. No update performed.`);
      // Optionally, append if not found? For now, just warn and do nothing else.
      return;
    }

    await this.saveData(updatedLines);
  }

  // NOTE: Granular deletions are deferred. This is a basic, less efficient implementation.
  async deleteLineById(id: string): Promise<void> {
    if (!id) {
      // console.warn('[FileHandler] deleteLineById: ID is empty. Skipping.');
      return;
    }
    // console.warn('[FileHandler] deleteLineById is inefficient (reads and writes entire file).');
    const lines = await this.loadData();
    let found = false;
    const filteredLines = lines.filter(line => {
      try {
        const item: Identifiable = JSON.parse(line);
        if (item.id === id) {
          found = true;
          return false; // Exclude this line
        }
      } catch (error) {
        // console.warn(`[FileHandler] Error parsing line during delete: ${line.substring(0,100)}...`, error);
      }
      return true; // Keep this line
    });

    if (!found) {
      // console.warn(`[FileHandler] deleteLineById: ID '${id}' not found. No deletion performed.`);
      return;
    }

    if (lines.length !== filteredLines.length) {
      await this.saveData(filteredLines);
    }
  }
} 