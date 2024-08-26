export { ImageDescriptor } from './types';
export { ImageSet, ImageSetManifest, IMAGE_SET_BUNDLE_TYPE } from './image';
export {
	BasicAuth,
	BearerAuth,
	Credentials,
	Authenticate,
	Scope,
	isBearerAuth,
	discoverAuthenticate,
	parseAuthenticateHeader,
	authenticate,
} from './registry';
