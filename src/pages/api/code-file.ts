import type { APIRoute } from 'astro';
import { readCodeFile } from '../../utils/discoverCodeSamples';

export const GET: APIRoute = ({ request }) => {
  const url = new URL(request.url);
  const project = url.searchParams.get('project');
  const file = url.searchParams.get('file');

  if (!project || !file) {
    return new Response(
      JSON.stringify({ error: 'Missing project or file parameter' }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  const content = readCodeFile(project, file);

  if (!content) {
    return new Response(
      JSON.stringify({ error: 'File not found or could not be read' }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  }

  return new Response(
    JSON.stringify({ content }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
      },
    }
  );
};
