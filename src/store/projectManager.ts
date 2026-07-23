import { promises as fs } from "fs";
import path from "path";
import { nanoid } from "nanoid";
import { CompositionSchema, emptyComposition, totalDurationInFrames, type Composition } from "../schema/scene";
import { logger } from "../core/utils/logger";

const PROJECTS_DIR = path.resolve(process.cwd(), "data", "projects");

export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  scenesCount: number;
  durationSeconds: number;
  fps: number;
  orientation: string;
}

export class ProjectManager {
  private async ensureDir() {
    await fs.mkdir(PROJECTS_DIR, { recursive: true });
  }

  async listProjects(): Promise<ProjectMeta[]> {
    await this.ensureDir();
    try {
      const files = await fs.readdir(PROJECTS_DIR);
      const metas: ProjectMeta[] = [];
      for (const file of files.filter((f) => f.endsWith(".json"))) {
        try {
          const raw = await fs.readFile(path.join(PROJECTS_DIR, file), "utf-8");
          const comp = CompositionSchema.parse(JSON.parse(raw));
          const id = file.replace(".json", "");
          metas.push({
            id,
            name: comp.name,
            createdAt: comp.metadata?.createdAt ?? new Date().toISOString(),
            updatedAt: comp.metadata?.updatedAt ?? new Date().toISOString(),
            scenesCount: comp.scenes.length,
            durationSeconds: Math.round((totalDurationInFrames(comp) / comp.fps) * 10) / 10,
            fps: comp.fps,
            orientation: comp.orientation,
          });
        } catch {
          // skip malformed files
        }
      }
      return metas.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    } catch {
      return [];
    }
  }

  async createProject(name: string): Promise<string> {
    await this.ensureDir();
    const id = nanoid(10);
    const now = new Date().toISOString();
    const comp: Composition = {
      ...emptyComposition(),
      name,
      metadata: { createdAt: now, updatedAt: now },
    };
    await fs.writeFile(path.join(PROJECTS_DIR, `${id}.json`), JSON.stringify(comp, null, 2));
    logger.info("Project created", { id, name });
    return id;
  }

  async saveProject(id: string, composition: Composition): Promise<void> {
    await this.ensureDir();
    const updated: Composition = {
      ...composition,
      metadata: { ...composition.metadata, updatedAt: new Date().toISOString() },
    };
    await fs.writeFile(path.join(PROJECTS_DIR, `${id}.json`), JSON.stringify(updated, null, 2));
  }

  async loadProject(id: string): Promise<Composition> {
    const raw = await fs.readFile(path.join(PROJECTS_DIR, `${id}.json`), "utf-8");
    return CompositionSchema.parse(JSON.parse(raw));
  }

  async deleteProject(id: string): Promise<void> {
    await fs.unlink(path.join(PROJECTS_DIR, `${id}.json`));
  }

  /** Snapshot a composition as a new project file and return its id. */
  async snapshotAsCurrent(composition: Composition): Promise<string> {
    await this.ensureDir();
    const id = `current-${nanoid(6)}`;
    await this.saveProject(id, composition);
    return id;
  }
}

export const projectManager = new ProjectManager();
