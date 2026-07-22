/**
 * Gutenberg editor UI for the "Annual Report Flipbook" block.
 * Written in plain JS (no build step) using wp.element.createElement
 * so the plugin has no bundler dependency.
 */
( function ( blocks, element, blockEditor, components, i18n ) {
	'use strict';

	var el = element.createElement;
	var __ = i18n.__;
	var MediaUpload = blockEditor.MediaUpload;
	var useBlockProps = blockEditor.useBlockProps;
	var InspectorControls = blockEditor.InspectorControls;
	var PanelBody = components.PanelBody;
	var Button = components.Button;
	var TextControl = components.TextControl;
	var Placeholder = components.Placeholder;

	blocks.registerBlockType( 'annual-report-flipbook/viewer', {
		title: __( 'Annual Report Flipbook', 'annual-report-flipbook' ),
		icon: 'book-alt',
		category: 'media',
		description: __( 'Embed a PDF as an interactive, accessible page-flip viewer.', 'annual-report-flipbook' ),
		attributes: {
			attachmentId: { type: 'number', default: 0 },
			title: { type: 'string', default: __( 'Annual report', 'annual-report-flipbook' ) },
		},

		edit: function ( props ) {
			var attributes = props.attributes;
			var setAttributes = props.setAttributes;
			var blockProps = useBlockProps();

			function onSelectMedia( media ) {
				if ( media && media.mime === 'application/pdf' ) {
					setAttributes( { attachmentId: media.id } );
				}
			}

			var mediaButton = el(
				MediaUpload,
				{
					onSelect: onSelectMedia,
					allowedTypes: [ 'application/pdf' ],
					value: attributes.attachmentId,
					render: function ( obj ) {
						return el(
							Button,
							{ variant: 'primary', onClick: obj.open },
							attributes.attachmentId
								? __( 'Replace PDF', 'annual-report-flipbook' )
								: __( 'Choose PDF from Media Library', 'annual-report-flipbook' )
						);
					},
				}
			);

			var inspector = el(
				InspectorControls,
				{},
				el(
					PanelBody,
					{ title: __( 'Flipbook settings', 'annual-report-flipbook' ) },
					el( TextControl, {
						label: __( 'Accessible title', 'annual-report-flipbook' ),
						value: attributes.title,
						onChange: function ( value ) {
							setAttributes( { title: value } );
						},
					} ),
					mediaButton
				)
			);

			var body;
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
					el( 'p', {}, __( 'Selected PDF attachment ID:', 'annual-report-flipbook' ) + ' ' + attributes.attachmentId ),
					mediaButton
				);
			}

			return el( 'div', blockProps, inspector, body );
		},

		// Dynamic block: rendered server-side via render_callback.
		save: function () {
			return null;
		},
	} );
} )( window.wp.blocks, window.wp.element, window.wp.blockEditor, window.wp.components, window.wp.i18n );
