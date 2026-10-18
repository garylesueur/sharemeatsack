"use client";
import { Component, type ReactNode } from "react";
import { type ViewFile } from "@/lib/file-view";
import { PreviewFallback } from "./file-preview";

// An unavailable renderer chunk must leave navigation and download usable.
export class PreviewBoundary extends Component<
  { file: ViewFile; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <PreviewFallback
        file={this.props.file}
        message="This preview could not be opened. Reload to try again, or download the original."
        retry={() => window.location.reload()}
      />
    ) : (
      this.props.children
    );
  }
}
