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
      className={`rounded-3xl border-2 border-dashed p-8 text-center transition sm:p-12 ${
        dragging ? "border-sky-500 bg-sky-50" : "border-slate-300 bg-slate-50"
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
      <p className="text-lg font-semibold text-slate-900">Drop files here</p>
      <p className="mt-2 text-sm text-slate-600">or select them with the file picker</p>
      <button
        className="mt-5 rounded-xl bg-sky-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-50"
        type="button"
        disabled={disabled}
        onClick={openPicker}
      >
        Choose {multiple ? "files" : "a file"}
      </button>
    </div>
  );
}
