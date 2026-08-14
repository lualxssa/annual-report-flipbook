/**
 * Admin drag-and-drop PDF uploader for the "Report Flipbook" settings page.
 * Uploads straight to the WP Media Library via the core REST API, then
 * hands the result to window.ArfbFlipbook for an immediate live preview.
 */
( function ( window, document ) {
	'use strict';

	document.addEventListener( 'DOMContentLoaded', () => {
		const cfg = window.arfbAdmin;
		if ( ! cfg ) {
			return;
		}

		const dropzone = document.getElementById( 'arfb-dropzone' );
		const fileInput = document.getElementById( 'arfb-file-input' );
		const status = document.getElementById( 'arfb-upload-status' );
		const previewWrap = document.getElementById( 'arfb-preview-wrap' );
		const previewEl = document.getElementById( 'arfb-preview' );
		const saveButton = document.getElementById( 'arfb-save-default' );
		const shortcodeEl = document.getElementById( 'arfb-shortcode' );

		if ( ! dropzone || ! fileInput ) {
			return;
		}

		// Reassigned after each successful upload, so the Save button knows which
		// attachment to store. let, not const.
		let currentAttachmentId = 0;

		const setStatus = ( message ) => {
			status.textContent = message;
		};

		const openBrowser = () => {
			fileInput.click();
		};

		const showPreview = ( attachmentId, pdfUrl ) => {
			previewWrap.style.display = '';
			if ( shortcodeEl ) {
				shortcodeEl.textContent = `[annual_report_flipbook id="${ attachmentId }"]`;
			}
			if ( window.ArfbFlipbook ) {
				window.ArfbFlipbook.reload( previewEl, pdfUrl );
			}
		};

		const handleFile = async ( file ) => {
			if ( file.type !== 'application/pdf' ) {
				setStatus( cfg.i18n.notAPdf );
				return;
			}

			setStatus( cfg.i18n.uploading );

			const formData = new FormData();
			formData.append( 'file', file, file.name );
			formData.append( 'title', file.name );

			try {
				const response = await fetch( cfg.restUrl, {
					method: 'POST',
					headers: {
						'X-WP-Nonce': cfg.restNonce,
					},
					body: formData,
					credentials: 'same-origin',
				} );

				if ( ! response.ok ) {
					throw new Error( `Upload failed with status ${ response.status }` );
				}

				const media = await response.json();
				currentAttachmentId = media.id;
				setStatus( '' );
				showPreview( media.id, media.source_url );
			} catch ( err ) {
				// eslint-disable-next-line no-console
				console.error( 'Annual Report Flipbook upload error:', err );
				setStatus( cfg.i18n.uploadError );
			}
		};

		dropzone.addEventListener( 'click', openBrowser );
		dropzone.addEventListener( 'keydown', ( e ) => {
			if ( e.key === 'Enter' || e.key === ' ' ) {
				e.preventDefault();
				openBrowser();
			}
		} );

		[ 'dragenter', 'dragover' ].forEach( ( evt ) => {
			dropzone.addEventListener( evt, ( e ) => {
				e.preventDefault();
				dropzone.classList.add( 'arfb-dropzone--active' );
			} );
		} );

		[ 'dragleave', 'drop' ].forEach( ( evt ) => {
			dropzone.addEventListener( evt, ( e ) => {
				e.preventDefault();
				dropzone.classList.remove( 'arfb-dropzone--active' );
			} );
		} );

		dropzone.addEventListener( 'drop', ( e ) => {
			const files = e.dataTransfer && e.dataTransfer.files;
			if ( files && files.length ) {
				handleFile( files[ 0 ] );
			}
		} );

		fileInput.addEventListener( 'change', ( e ) => {
			if ( e.target.files && e.target.files.length ) {
				handleFile( e.target.files[ 0 ] );
			}
		} );

		if ( saveButton ) {
			saveButton.addEventListener( 'click', async () => {
				if ( ! currentAttachmentId ) {
					return;
				}

				const body = new URLSearchParams();
				body.append( 'action', 'arfb_save_attachment' );
				body.append( 'nonce', cfg.saveNonce );
				body.append( 'attachment_id', currentAttachmentId );

				try {
					const response = await fetch( cfg.ajaxUrl, {
						method: 'POST',
						headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
						body: body.toString(),
						credentials: 'same-origin',
					} );
					const result = await response.json();
					setStatus( result && result.success ? cfg.i18n.saved : cfg.i18n.uploadError );
				} catch ( err ) {
					setStatus( cfg.i18n.uploadError );
				}
			} );
		}
	} );
} )( window, document );
