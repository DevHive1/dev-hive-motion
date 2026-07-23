import React, { useState, useRef, useEffect } from "react";
import type { Composition } from "../../../schema/scene";

export interface MentionItem {
  type: "scene" | "element";
  id: string;
  name: string;
  sceneId?: string;
}

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onSend: (mentions: MentionItem[], imageUrls: string[]) => void;
  composition: Composition;
  busy: boolean;
}

function compressImage(file: File, maxWidth = 1024, maxHeight = 1024): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.85));
        } else {
          resolve(String(e.target?.result));
        }
      };
      img.onerror = () => resolve(String(e.target?.result));
      img.src = String(e.target?.result);
    };
    reader.readAsDataURL(file);
  });
}

export const MentionInput: React.FC<MentionInputProps> = ({
  value,
  onChange,
  onSend,
  composition,
  busy,
}) => {
  const [activeMentions, setActiveMentions] = useState<MentionItem[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mentionFilter, setMentionFilter] = useState("");
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Collect candidate items (scenes + elements)
  const candidateItems: MentionItem[] = [];
  composition.scenes.forEach((scene) => {
    candidateItems.push({ type: "scene", id: scene.id, name: scene.name });
    scene.elements.forEach((el) => {
      candidateItems.push({ type: "element", id: el.id, name: el.name, sceneId: scene.id });
    });
  });

  const filteredItems = candidateItems.filter((item) =>
    item.name.toLowerCase().includes(mentionFilter.toLowerCase()),
  );

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);

    const lastCharIndex = newValue.lastIndexOf("@");
    if (lastCharIndex !== -1 && lastCharIndex === newValue.length - 1) {
      setShowDropdown(true);
      setMentionFilter("");
    } else if (showDropdown && lastCharIndex !== -1) {
      setMentionFilter(newValue.slice(lastCharIndex + 1));
    } else {
      setShowDropdown(false);
    }
  };

  const selectMention = (item: MentionItem) => {
    const lastAt = value.lastIndexOf("@");
    const updatedValue = value.slice(0, lastAt) + `@${item.name} `;
    onChange(updatedValue);
    if (!activeMentions.some((m) => m.id === item.id)) {
      setActiveMentions([...activeMentions, item]);
    }
    setShowDropdown(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;

    for (const file of Array.from(files)) {
      const compressed = await compressImage(file);
      setImageUrls((prev) => [...prev, compressed]);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleSendClick = () => {
    if (!value.trim() || busy) return;
    onSend(activeMentions, imageUrls);
    setActiveMentions([]);
    setImageUrls([]);
  };

  return (
    <div className="mention-input-container">
      {imageUrls.length > 0 && (
        <div className="image-preview-strip">
          {imageUrls.map((url, i) => (
            <div key={i} className="image-preview-badge">
              <img src={url} alt="attached reference" />
              <button
                type="button"
                className="remove-img-btn"
                onClick={() => setImageUrls(imageUrls.filter((_, idx) => idx !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {showDropdown && filteredItems.length > 0 && (
        <div className="mention-dropdown">
          <div className="mention-dropdown-header">Select element or scene:</div>
          {filteredItems.slice(0, 8).map((item) => (
            <div
              key={item.id}
              className="mention-dropdown-item"
              onClick={() => selectMention(item)}
            >
              <span className={`mention-type-badge ${item.type}`}>{item.type}</span>
              <span className="mention-name">{item.name}</span>
            </div>
          ))}
        </div>
      )}

      <div className="chat-input-row">
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={handleImageUpload}
        />
        <button
          type="button"
          className="attach-btn"
          title="Attach reference image for AI context"
          onClick={() => fileInputRef.current?.click()}
        >
          📷
        </button>
        <input
          value={value}
          placeholder='Ask agent (use @ to mention elements, e.g. "change font size of @Title")'
          onChange={handleTextChange}
          onKeyDown={(e) => e.key === "Enter" && handleSendClick()}
          disabled={busy}
        />
        <button onClick={handleSendClick} disabled={busy || !value.trim()}>
          {busy ? "Working…" : "Send"}
        </button>
      </div>
    </div>
  );
};
