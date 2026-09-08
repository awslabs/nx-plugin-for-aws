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

/**
 * The AWS Cloud architecture icon, filled with the pill's own colour. Its outline
 * is stroked as well as filled so it carries the same weight as the Projects icon
 * beside it at this size.
 */
const AWS_ICON = (
  <svg
    viewBox="5 8 30 22"
    aria-hidden="true"
    fill="currentColor"
    fillRule="evenodd"
    stroke="currentColor"
    strokeWidth="0.45"
    strokeLinejoin="round"
  >
    <path d="M28.993,27.9952689 L11.487,27.9762689 C9.121,27.9742689 7.154,26.1292689 7.012,23.7752689 C7.004,23.6522689 7,23.5262689 7,23.3972689 C7,20.2992689 9.091,19.2872689 10.337,18.9592689 C10.577,18.8962689 10.735,18.6662689 10.707,18.4192689 C10.676,18.1492689 10.659,17.8752689 10.659,17.5962689 C10.659,15.1322689 12.308,12.4822689 14.415,11.5632689 C15.359,11.1502689 16.232,10.9862689 17.023,10.9862689 C19.276,10.9862689 20.867,12.3152689 21.561,13.0332689 C22.329,13.8262689 22.927,14.8382689 23.34,16.0422689 C23.4,16.2192689 23.555,16.3472689 23.74,16.3742689 C23.918,16.4012689 24.109,16.3232689 24.219,16.1712689 C24.807,15.3502689 25.766,14.9822689 26.659,15.2392689 C27.782,15.5602689 28.516,16.7272689 28.62,18.3072689 C28.578,18.5762689 28.759,18.8292689 29.027,18.8772689 C30.222,19.0892689 33,19.9572689 33,23.4402689 C33,27.5892689 29.114,27.9822689 28.993,27.9952689 M29.594,17.9742689 C29.379,16.0672689 28.4,14.6962689 26.934,14.2782689 C25.899,13.9822689 24.811,14.2452689 23.989,14.9502689 C23.553,13.9362689 22.979,13.0602689 22.28,12.3382689 C20.023,10.0052689 16.933,9.37226889 14.014,10.6462689 C11.531,11.7302689 9.659,14.7182689 9.659,17.5962689 C9.659,17.7702689 9.665,17.9432689 9.676,18.1142689 C8.319,18.5732689 6,19.8752689 6,23.3972689 C6,23.5492689 6.004,23.6962689 6.014,23.8382689 C6.188,26.7162689 8.593,28.9732689 11.486,28.9762689 L29.034,28.9932689 C29.084,28.9892689 34,28.5192689 34,23.4402689 C34,19.5022689 31.003,18.3142689 29.594,17.9742689" />
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
