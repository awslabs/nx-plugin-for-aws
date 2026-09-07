/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Which diagram a read-only graph is showing. */
export type DiagramView = 'projects' | 'infrastructure';

const PROJECTS_ICON = (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2.5" y="9" width="6" height="6" rx="1.5" />
    <rect x="15.5" y="3.5" width="6" height="6" rx="1.5" />
    <rect x="15.5" y="14.5" width="6" height="6" rx="1.5" />
    <path d="M8.5 12h3.5M12 12V6.5h3.5M12 12v5.5h3.5" />
  </svg>
);

const AWS_ICON = (
  <svg
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M6.5 18.5h11a3.75 3.75 0 0 0 .4-7.48 5.5 5.5 0 0 0-10.6-1.4A3.8 3.8 0 0 0 6.5 18.5Z" />
    <path d="M9.5 21.5c2.5 1.3 6.5 1.3 9 0" />
  </svg>
);

interface Props {
  view: DiagramView;
  onChange: (view: DiagramView) => void;
}

/**
 * The switch between the two ways of reading the same graph: the projects a
 * workspace holds, and the AWS infrastructure they deploy.
 *
 * Sits in the top left of the diagram it belongs to, showing both options at once
 * so the other view is visible rather than something to be discovered.
 */
export const ViewToggle = ({ view, onChange }: Props) => (
  <div className="gb-view-toggle">
    <button
      type="button"
      className={`gb-view-toggle-btn${view === 'projects' ? ' is-active' : ''}`}
      aria-pressed={view === 'projects'}
      aria-label="Show the projects in the workspace"
      title="Show the projects in the workspace"
      onClick={() => onChange('projects')}
    >
      {PROJECTS_ICON}
      <span>Projects</span>
    </button>
    <button
      type="button"
      className={`gb-view-toggle-btn${
        view === 'infrastructure' ? ' is-active' : ''
      }`}
      aria-pressed={view === 'infrastructure'}
      aria-label="Show the AWS infrastructure the projects deploy"
      title="Show the AWS infrastructure the projects deploy"
      onClick={() => onChange('infrastructure')}
    >
      {AWS_ICON}
      <span>AWS</span>
    </button>
  </div>
);

/**
 * The same pill, saying which diagram this is, where there is nothing to switch
 * to — a guide's architecture diagram is one project's AWS infrastructure and
 * nothing else.
 */
export const ViewMark = ({ view }: { view: DiagramView }) => (
  <div className="gb-view-toggle gb-view-toggle--static">
    <span className="gb-view-toggle-btn is-active">
      {view === 'projects' ? PROJECTS_ICON : AWS_ICON}
      <span>{view === 'projects' ? 'Projects' : 'AWS'}</span>
    </span>
  </div>
);

export default ViewToggle;
