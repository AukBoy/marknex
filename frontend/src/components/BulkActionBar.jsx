import React from 'react';
import { Trash2, Archive, CheckSquare, Copy } from 'lucide-react';
import './BulkActionBar.css';

// Reusable bulk action bar for multi-select operations
function BulkActionBar({ selectedCount, onDelete, onArchive, onDuplicate, onSelectAll, onClearSelection, totalCount }) {
    if (selectedCount === 0) return null;

    return (
        <div className="bulk-action-bar">
            <div className="bulk-info">
                <input
                    type="checkbox"
                    aria-label="Select all items"
                    onChange={(e) => {
                        if (e.target.checked) {
                            onSelectAll?.();
                        } else {
                            onClearSelection?.();
                        }
                    }}
                    checked={selectedCount === totalCount && totalCount > 0}
                    indeterminate={selectedCount > 0 && selectedCount < totalCount}
                />
                <span className="selection-text">
                    {selectedCount} of {totalCount} selected
                </span>
            </div>

            <div className="bulk-actions">
                {onDuplicate && (
                    <button
                        onClick={() => onDuplicate()}
                        className="bulk-btn"
                        title="Duplicate selected items"
                        aria-label={`Duplicate ${selectedCount} selected items`}
                    >
                        <Copy size={16} /> Duplicate
                    </button>
                )}
                {onArchive && (
                    <button
                        onClick={() => onArchive()}
                        className="bulk-btn"
                        title="Archive selected items"
                        aria-label={`Archive ${selectedCount} selected items`}
                    >
                        <Archive size={16} /> Archive
                    </button>
                )}
                {onDelete && (
                    <button
                        onClick={() => {
                            if (window.confirm(`Delete ${selectedCount} item(s)? This cannot be undone.`)) {
                                onDelete();
                            }
                        }}
                        className="bulk-btn bulk-btn-danger"
                        title="Delete selected items permanently"
                        aria-label={`Delete ${selectedCount} selected items`}
                    >
                        <Trash2 size={16} /> Delete
                    </button>
                )}
                <button
                    onClick={onClearSelection}
                    className="bulk-btn bulk-btn-secondary"
                    title="Clear selection"
                    aria-label="Clear selection"
                >
                    Clear
                </button>
            </div>
        </div>
    );
}

export default BulkActionBar;
