import React, { useEffect, useRef, useState } from "react";
import type { ProjectMeta } from "../../store/projectManager";

interface ProjectPickerProps {
  currentName: string;
  onLoad: (composition: unknown) => void;
}

export const ProjectPicker: React.FC<ProjectPickerProps> = ({ currentName, onLoad }) => {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [newName, setNewName] = useState("");
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchProjects = async () => {
    const res = await fetch("/api/projects");
    if (res.ok) setProjects(await res.json());
  };

  useEffect(() => {
    if (open) fetchProjects();
  }, [open]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const createProject = async () => {
    if (!newName.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        const { id } = await res.json();
        await loadProject(id);
        setNewName("");
      }
    } finally {
      setLoading(false);
    }
  };

  const loadProject = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${id}/load`, { method: "POST" });
      if (res.ok) {
        const comp = await res.json();
        onLoad(comp);
      }
    } finally {
      setLoading(false);
      setOpen(false);
    }
  };

  const deleteProject = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("Delete this project permanently?")) return;
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    fetchProjects();
  };

  const orientationBadge = (o: string) => {
    const map: Record<string, string> = { landscape: "16:9", portrait: "9:16", square: "1:1" };
    return map[o] ?? o;
  };

  return (
    <div className="project-picker" ref={ref}>
      <button
        className="project-picker-btn"
        onClick={() => setOpen(!open)}
        title="Switch project"
      >
        <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
          <path d="M2 3a1 1 0 011-1h3.586a1 1 0 01.707.293L8.707 3.7A1 1 0 009.414 4H13a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3z" />
        </svg>
        <span className="project-picker-name">{currentName}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" className="project-picker-chevron">
          <path d="M2 3.5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="project-dropdown">
          <div className="project-dropdown-header">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
              <path d="M2 3a1 1 0 011-1h3.586a1 1 0 01.707.293L8.707 3.7A1 1 0 009.414 4H13a1 1 0 011 1v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3z" />
            </svg>
            Projects
          </div>

          {/* Create new */}
          <div className="project-new-row">
            <input
              className="project-new-input"
              placeholder="New project name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createProject()}
              autoFocus
            />
            <button
              className="project-new-btn"
              onClick={createProject}
              disabled={loading || !newName.trim()}
              title="Create project"
            >
              {loading ? "…" : "+"}
            </button>
          </div>

          {/* Divider */}
          <div className="project-divider" />

          {/* Project list */}
          {projects.length === 0 ? (
            <div className="project-empty">No saved projects yet</div>
          ) : (
            <div className="project-list">
              {projects.map((p) => (
                <div key={p.id} className="project-item" onClick={() => loadProject(p.id)}>
                  <div className="project-item-info">
                    <div className="project-item-name">{p.name}</div>
                    <div className="project-item-meta">
                      {p.scenesCount} scenes · {p.durationSeconds}s · {orientationBadge(p.orientation)}
                    </div>
                  </div>
                  <button
                    className="project-delete-btn"
                    onClick={(e) => deleteProject(p.id, e)}
                    title="Delete project"
                  >
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
                      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
