/**
 * Gutenberg editor UI for the "Annual Report Flipbook" block.
 * Written in plain JS (no build step) using wp.element.createElement
 * so the plugin has no bundler dependency.
 */
( function ( blocks, element, blockEditor, components, i18n ) {
	'use strict';

	const el = element.createElement;
	const { __ } = i18n;
	const { MediaUpload, useBlockProps, InspectorControls } = blockEditor;
	const { PanelBody, Button, TextControl, SelectControl, Placeholder } = components;

	const SIZE_OPTIONS = [
		{ label: __( 'Small (600px)', 'annual-report-flipbook' ), value: 'small' },
		{ label: __( 'Medium (900px)', 'annual-report-flipbook' ), value: 'medium' },
		{ label: __( 'Large (1200px)', 'annual-report-flipbook' ), value: 'large' },
		{ label: __( 'Full width', 'annual-report-flipbook' ), value: 'full' },
		{ label: __( 'Custom…', 'annual-report-flipbook' ), value: 'custom' },
	];

	blocks.registerBlockType( 'annual-report-flipbook/viewer', {
		title: __( 'Annual Report Flipbook', 'annual-report-flipbook' ),
		icon: 'book-alt',
		category: 'media',
		description: __( 'Embed a PDF as an interactive, accessible page-flip viewer.', 'annual-report-flipbook' ),
		attributes: {
			attachmentId: { type: 'number', default: 0 },
			title: { type: 'string', default: __( 'Annual report', 'annual-report-flipbook' ) },
			size: { type: 'string', default: 'medium' },
			customWidth: { type: 'string', default: '' },
		},

		edit: ( { attributes, setAttributes } ) => {
			// The editor UI stores the chosen PDF as an attachment ID. The server-side
			// renderer resolves the real URL when the block is published.
			const blockProps = useBlockProps();

			const onSelectMedia = ( media ) => {
				if ( media && media.mime === 'application/pdf' ) {
					setAttributes( { attachmentId: media.id } );
				}
			};

			const mediaButton = el( MediaUpload, {
				onSelect: onSelectMedia,
				allowedTypes: [ 'application/pdf' ],
				value: attributes.attachmentId,
				render: ( obj ) => el(
					Button,
					{ variant: 'primary', onClick: obj.open },
					attributes.attachmentId
						? __( 'Replace PDF', 'annual-report-flipbook' )
						: __( 'Choose PDF from Media Library', 'annual-report-flipbook' )
				),
			} );

			const sizeControl = el( SelectControl, {
				label: __( 'Viewer size', 'annual-report-flipbook' ),
				value: attributes.size,
				options: SIZE_OPTIONS,
				onChange: ( value ) => setAttributes( { size: value } ),
			} );

			const customWidthControl = attributes.size === 'custom'
				? el( TextControl, {
					label: __( 'Custom width', 'annual-report-flipbook' ),
					help: __( 'A CSS width, e.g. 800px or 100%.', 'annual-report-flipbook' ),
					value: attributes.customWidth,
					onChange: ( value ) => setAttributes( { customWidth: value } ),
				} )
				: null;

			const inspector = el(
				InspectorControls,
				{},
				el(
					PanelBody,
					{ title: __( 'Flipbook settings', 'annual-report-flipbook' ) },
					el( TextControl, {
						label: __( 'Accessible title', 'annual-report-flipbook' ),
						value: attributes.title,
						onChange: ( value ) => setAttributes( { title: value } ),
					} ),
					sizeControl,
					customWidthControl,
					mediaButton
				)
			);

			let body;
			// If no PDF has been chosen yet, show a simple placeholder and let the
			// editor pick one from the Media Library.
			if ( ! attributes.attachmentId ) {
				body = el(
					Placeholder,
					{
						icon: 'book-alt',
						label: __( 'Annual Report Flipbook', 'annual-report-flipbook' ),
						instructions: __( 'Drop a PDF in the "Report Flipbook" admin page first, or choose one below.', 'annual-report-flipbook' ),
					},
					mediaButton
				);
			} else {
				body = el(
					'div',
					{ className: 'arfb-editor-preview' },
					el( 'p', {}, __( 'Flipbook preview renders on the published page.', 'annual-report-flipbook' ) ),
					el( 'p', {}, `${ __( 'Selected PDF attachment ID:', 'annual-report-flipbook' ) } ${ attributes.attachmentId }` ),
					mediaButton
				);
			}

			return el( 'div', blockProps, inspector, body );
		},

		// Dynamic block: rendered server-side via render_callback.
		save: () => null,
	} );
} )( window.wp.blocks, window.wp.element, window.wp.blockEditor, window.wp.components, window.wp.i18n );
