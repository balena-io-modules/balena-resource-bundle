export { DockerArchive } from './archive';
export {
	BasicAuth,
	BearerAuth,
	Credentials,
	Authenticate,
	Scope,
	discoverAuthenticate,
	parseAuthenticateHeader,
	authenticate,
	fetchImage,
	fetchImages,
	parseImageName,
	unparseImageName,
} from './registry';
export { Image, ImageDescriptor } from './types';
