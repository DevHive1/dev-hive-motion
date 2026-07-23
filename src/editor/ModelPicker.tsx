import React, { useEffect, useState } from "react";

export const ModelPicker: React.FC<{
  value: string;
  onChange: (model: string) => void;
}> = ({ value, onChange }) => {
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/models")
      .then((res) => res.json())
      .then((data: { models?: string[]; defaultModel?: string; error?: string }) => {
        if (data.error) {
          setError(data.error);
          return;
        }
        setModels(data.models ?? []);
        if (!value && data.defaultModel) onChange(data.defaultModel);
      })
      .catch(() => setError("Couldn't reach the server."));
    // Only fetch once on mount - re-fetching on every value change isn't needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="model-picker error" title={error}>
        <select disabled>
          <option>No models found</option>
        </select>
      </div>
    );
  }

  return (
    <div className="model-picker">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {models.length === 0 && <option value={value}>{value || "loading…"}</option>}
        {models.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </select>
    </div>
  );
};
