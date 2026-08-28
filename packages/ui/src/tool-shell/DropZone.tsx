import { useRef, useState, type DragEvent } from "react";

interface DropZoneProps {
  accepts: readonly string[];
  multiple: boolean;
  disabled: boolean;
  onFiles(files: readonly File[]): void;
  onPickerOpen(): void;
  onPickerClosed(): void;
}

export function DropZone({
  accepts,
  multiple,
  disabled,
  onFiles,
  onPickerOpen,
  onPickerClosed,
}: DropZoneProps) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const openPicker = (): void => {
    if (disabled) return;
    onPickerOpen();
    input.current?.click();
    queueMicrotask(onPickerClosed);
  };
  const drop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setDragging(false);
    if (!disabled && event.dataTransfer.files.length > 0) {
      onFiles([...event.dataTransfer.files]);
    }
  };

  return (
    <div
      className={`rounded-[1.5rem] border-2 border-dashed p-10 text-center transition sm:p-14 ${
        dragging ? "border-indigo-500 bg-indigo-50/50" : "border-slate-300/80 bg-white"
      }`}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={drop}
      data-testid="drop-zone"
    >
      <input
        ref={input}
        className="sr-only"
        type="file"
        tabIndex={-1}
        accept={accepts.join(",")}
        multiple={multiple}
        disabled={disabled}
        onChange={(event) => {
          if (event.currentTarget.files) onFiles([...event.currentTarget.files]);
          event.currentTarget.value = "";
        }}
      />

      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </div>

      {dragging ? (
        <p className="text-[1.125rem] font-semibold text-indigo-600">Drop to add your files</p>
      ) : (
        <p className="text-[1.125rem] font-semibold text-slate-900">Drop files here</p>
      )}

      {!dragging && (
        <p className="mt-2 text-[0.9rem] text-slate-500">or choose files from your device</p>
      )}

      <button
        className="mt-6 rounded-xl bg-indigo-500 px-6 py-2.5 font-medium text-white shadow-sm transition-colors hover:bg-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50"
        type="button"
        disabled={disabled}
        onClick={openPicker}
      >
        Choose files
      </button>

      <p className="mt-6 text-[0.85rem] text-slate-500">Files up to 50 MB each</p>
    </div>
  );
}
