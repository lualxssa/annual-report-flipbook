/**
 * Admin drag-and-drop PDF uploader for the "Report Flipbook" settings page.
 * Uploads straight to the WP Media Library via the core REST API, then
 * hands the result to window.ArfbFlipbook for an immediate live preview.
 */
( function ( window, document ) {
	'use strict';

	document.addEventListener( 'DOMContentLoaded', function () {
		var cfg = window.arfbAdmin;
		if ( ! cfg ) {
			return;
		}

		var dropzone = document.getElementById( 'arfb-dropzone' );
		var fileInput = document.getElementById( 'arfb-file-input' );
		var status = document.getElementById( 'arfb-upload-status' );
		var previewWrap = document.getElementById( 'arfb-preview-wrap' );
		var previewEl = document.getElementById( 'arfb-preview' );
		var saveButton = document.getElementById( 'arfb-save-default' );
		var shortcodeEl = document.getElementById( 'arfb-shortcode' );

		if ( ! dropzone || ! fileInput ) {
			return;
		}

		var currentAttachmentId = 0;

		function setStatus( message ) {
			status.textContent = message;
		}

		function openBrowser() {
			fileInput.click();
		}

		dropzone.addEventListener( 'click', openBrowser );
		dropzone.addEventListener( 'keydown', function ( e ) {
			if ( e.key === 'Enter' || e.key === ' ' ) {
				e.preventDefault();
				openBrowser();
			}
		} );

		[ 'dragenter', 'dragover' ].forEach( function ( evt ) {
			dropzone.addEventListener( evt, function ( e ) {
				e.preventDefault();
				dropzone.classList.add( 'arfb-dropzone--active' );
			} );
		} );

		[ 'dragleave', 'drop' ].forEach( function ( evt ) {
			dropzone.addEventListener( evt, function ( e ) {
				e.preventDefault();
				dropzone.classList.remove( 'arfb-dropzone--active' );
			} );
		} );

		dropzone.addEventListener( 'drop', function ( e ) {
			var files = e.dataTransfer && e.dataTransfer.files;
			if ( files && files.length ) {
				handleFile( files[ 0 ] );
			}
		} );

		fileInput.addEventListener( 'change', function ( e ) {
			if ( e.target.files && e.target.files.length ) {
				handleFile( e.target.files[ 0 ] );
			}
		} );

		function handleFile( file ) {
			if ( file.type !== 'application/pdf' ) {
				setStatus( cfg.i18n.notAPdf );
				return;
			}

			setStatus( cfg.i18n.uploading );

			var formData = new FormData();
			formData.append( 'file', file, file.name );
			formData.append( 'title', file.name );

			fetch( cfg.restUrl, {
				method: 'POST',
				headers: {
					'X-WP-Nonce': cfg.restNonce,
				},
				body: formData,
				credentials: 'same-origin',
			} )
				.then( function ( response ) {
					if ( ! response.ok ) {
						throw new Error( 'Upload failed with status ' + response.status );
					}
					return response.json();
				} )
				.then( function ( media ) {
					currentAttachmentId = media.id;
					setStatus( '' );
					showPreview( media.id, media.source_url );
				} )
				.catch( function ( err ) {
					// eslint-disable-next-line no-console
					console.error( 'Annual Report Flipbook upload error:', err );
					setStatus( cfg.i18n.uploadError );
				} );
		}

		function showPreview( attachmentId, pdfUrl ) {
			previewWrap.style.display = '';
			if ( shortcodeEl ) {
				shortcodeEl.textContent = '[annual_report_flipbook id="' + attachmentId + '"]';
			}
			if ( window.ArfbFlipbook ) {
				window.ArfbFlipbook.reload( previewEl, pdfUrl );
			}
		}

		if ( saveButton ) {
			saveButton.addEventListener( 'click', function () {
				if ( ! currentAttachmentId ) {
					return;
				}
				var body = new URLSearchParams();
				body.append( 'action', 'arfb_save_attachment' );
				body.append( 'nonce', cfg.saveNonce );
				body.append( 'attachment_id', currentAttachmentId );

				fetch( cfg.ajaxUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
					body: body.toString(),
					credentials: 'same-origin',
				} )
					.then( function ( response ) {
						return response.json();
					} )
					.then( function ( result ) {
						if ( result && result.success ) {
							setStatus( cfg.i18n.saved );
						} else {
							setStatus( cfg.i18n.uploadError );
						}
					} )
					.catch( function () {
						setStatus( cfg.i18n.uploadError );
					} );
			} );
		}
	} );
} )( window, document );
